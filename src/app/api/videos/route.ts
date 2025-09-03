// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// rangeパラメータを厳密に解釈
function parseRange(raw: string | null): { from: Date; label: "24h" | "7d" | "30d" } {
  const now = Date.now();
  const v = (raw ?? "24h").toLowerCase();
  if (v.startsWith("7")) return { from: new Date(now - 7 * 24 * 3600_000), label: "7d" };
  if (v.startsWith("30")) return { from: new Date(now - 30 * 24 * 3600_000), label: "30d" };
  return { from: new Date(now - 24 * 3600_000), label: "24h" };
}

// shorts フィルタを durationSec 基準で
function applyShorts(where: Prisma.VideoWhereInput, mode: string | null) {
  const m = (mode ?? "any").toLowerCase(); // any|only|exclude|long
  if (m === "only") {
    where.durationSec = { lt: 60 };
  } else if (m === "exclude") {
    // long or 不明（null）
    where.OR = [{ durationSec: { gte: 61 } }, { durationSec: null as any }];
  } else if (m === "long") {
    where.durationSec = { gte: 61 };
  }
}

// SupportSnapshot がある場合の期間集計（なければフォールバック）
async function getSupportPointsMap(from: Date): Promise<Record<string, number>> {
  // まず列が取れるか動的に試す（列名が違ってもビルドが止まらないよう raw を try/catch）
  try {
    // 可能なら hearts, flames, supporters を加重合算
    const rows: Array<{ videoId: string; points: number }> = await prisma.$queryRawUnsafe(
      `
      WITH cols AS (
        SELECT array_agg(column_name) AS cols
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'SupportSnapshot'
      )
      SELECT "videoId",
             COALESCE(
               SUM(
                 (CASE WHEN 'hearts'     = ANY((SELECT cols FROM cols)) THEN COALESCE("hearts",0)     ELSE 0 END) * 1 +
                 (CASE WHEN 'flames'     = ANY((SELECT cols FROM cols)) THEN COALESCE("flames",0)     ELSE 0 END) * 3 +
                 (CASE WHEN 'supporters' = ANY((SELECT cols FROM cols)) THEN COALESCE("supporters",0) ELSE 0 END) * 5 +
                 (CASE WHEN 'likes'      = ANY((SELECT cols FROM cols)) THEN COALESCE("likes",0)      ELSE 0 END) * 0
               ), 0
             ) AS points
        FROM "SupportSnapshot"
       WHERE "createdAt" >= $1
       GROUP BY "videoId"
      `,
      from
    );
    return Object.fromEntries(rows.map((r) => [r.videoId, Number(r.points) || 0]));
  } catch {
    // テーブルや列が無い等 → 期間内の件数×5 をポイントとして使う最低限のフォールバック
    try {
      const rows: Array<{ videoId: string; points: number }> = await prisma.$queryRaw`
        SELECT "videoId", COUNT(*)::int * 5 AS points
          FROM "SupportSnapshot"
         WHERE "createdAt" >= ${from}
         GROUP BY "videoId"
      `;
      return Object.fromEntries(rows.map((r) => [r.videoId, Number(r.points) || 0]));
    } catch {
      // テーブル自体が無い
      return {};
    }
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // ページング
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") || "24", 10)));
  const skip = (page - 1) * take;

  const { from, label } = parseRange(searchParams.get("range"));
  const shorts = searchParams.get("shorts"); // any|only|exclude|long
  const sort = (searchParams.get("sort") || "trending").toLowerCase(); // trending|support|latest|popular

  // where を段階的に作る（Prisma型エラーを避ける）
  const where: Prisma.VideoWhereInput = { publishedAt: { gte: from } };
  applyShorts(where, shorts);

  // まず候補を多めに取る（急上昇の並べ替えに必要）
  const candidates = await prisma.video.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: Math.max(skip + take, 200), // ある程度多め
    select: {
      id: true,
      title: true,
      url: true,
      channelTitle: true,
      thumbnailUrl: true,
      publishedAt: true,
      durationSec: true,
      views: true,
      likes: true,
    },
  });

  // 期間内応援ポイント（ある場合のみ）→ 無ければ 0
  const supportMap = await getSupportPointsMap(from);

  // 急上昇スコア（時間減衰＋応援＋閲覧の簡易合成）
  const now = Date.now();
  const withScore = candidates.map((v) => {
    const published = (v.publishedAt ? new Date(v.publishedAt) : new Date()).getTime();
    const hours = Math.max(1, (now - published) / 3600_000);
    const support = supportMap[v.id] || 0;
    const views = Number(v.views || 0);
    const likes = Number(v.likes || 0);

    // 時間減衰（24hで^0.35 くらい）
    const decay = Math.pow(hours / 24, 0.35);
    // 合成スコア（必要に応じて係数を調整）
    const score = (support * 1.0 + likes * 0.5 + Math.sqrt(views)) / decay;

    return { ...v, support, score };
  });

  // 並び替え
  let sorted = withScore;
  if (sort === "latest") {
    sorted = [...withScore].sort((a, b) => Number(b.publishedAt) - Number(a.publishedAt));
  } else if (sort === "popular") {
    sorted = [...withScore].sort((a, b) => (b.views || 0) - (a.views || 0));
  } else if (sort === "support") {
    sorted = [...withScore].sort((a, b) => b.support - a.support);
  } else {
    // trending
    sorted = [...withScore].sort((a, b) => b.score - a.score);
  }

  const total = sorted.length;
  const items = sorted.slice(skip, skip + take);

  return NextResponse.json({
    ok: true,
    meta: { range: label, page, take, total },
    items,
  });
}
