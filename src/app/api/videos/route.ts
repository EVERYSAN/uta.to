import { NextRequest, NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const prisma = new PrismaClient();

// range=24h|7d|30d
function parseRange(raw: string | null): { from: Date; label: "24h"|"7d"|"30d" } {
  const now = Date.now();
  const v = (raw ?? "24h").toLowerCase();
  if (v.startsWith("7"))  return { from: new Date(now - 7  * 24 * 3600_000), label: "7d"  };
  if (v.startsWith("30")) return { from: new Date(now - 30 * 24 * 3600_000), label: "30d" };
  return { from: new Date(now - 24 * 3600_000), label: "24h" };
}

// long/short を durationSec 基準で付与
function applyShorts(where: Prisma.VideoWhereInput, mode: string | null) {
  const m = (mode ?? "any").toLowerCase(); // any|only|exclude|long
  if (m === "only") {
    where.durationSec = { lt: 60 };
  } else if (m === "exclude") {
    // ロング or 不明(null) を許可
    where.OR = [{ durationSec: { gte: 61 } }, { durationSec: null as any }];
  } else if (m === "long") {
    where.durationSec = { gte: 61 };
  }
}

async function supportTableExists(): Promise<boolean> {
  try {
    // public."SupportSnapshot" が存在するか
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."SupportSnapshot"') IS NOT NULL AS exists`
    );
    return Boolean(rows?.[0]?.exists);
  } catch {
    return false;
  }
}

async function getSupportPointsMap(from: Date): Promise<Record<string, number>> {
  if (!(await supportTableExists())) return {};
  // 列が無い環境でも落ちないよう、存在する列だけ合算する
  try {
    const rows: Array<{ videoId: string; points: number }> = await prisma.$queryRawUnsafe(
      `
      WITH cols AS (
        SELECT array_agg(column_name) AS cols
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'SupportSnapshot'
      )
      SELECT "videoId",
             SUM(
               (CASE WHEN 'hearts'     = ANY((SELECT cols FROM cols)) THEN COALESCE("hearts",0)     ELSE 0 END) * 1 +
               (CASE WHEN 'flames'     = ANY((SELECT cols FROM cols)) THEN COALESCE("flames",0)     ELSE 0 END) * 3 +
               (CASE WHEN 'supporters' = ANY((SELECT cols FROM cols)) THEN COALESCE("supporters",0) ELSE 0 END) * 5 +
               (CASE WHEN 'likes'      = ANY((SELECT cols FROM cols)) THEN COALESCE("likes",0)      ELSE 0 END) * 0
             )::float AS points
        FROM "SupportSnapshot"
       WHERE "createdAt" >= $1
       GROUP BY "videoId"
      `,
      from
    );
    return Object.fromEntries(rows.map(r => [r.videoId, Number(r.points) || 0]));
  } catch {
    // それでも失敗したら 0 扱い
    return {};
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const page  = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const take  = Math.min(50, Math.max(1, parseInt(searchParams.get("take") || "24", 10)));
    const skip  = (page - 1) * take;
    const sort  = (searchParams.get("sort") || "trending").toLowerCase(); // trending|support|latest|popular
    const { from, label } = parseRange(searchParams.get("range"));
    const shorts = searchParams.get("shorts"); // any|only|exclude|long

    const where: Prisma.VideoWhereInput = { publishedAt: { gte: from } };
    applyShorts(where, shorts);

    // 候補を多めに取得
    const candidates = await prisma.video.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: Math.max(skip + take, 200),
      select: {
        id: true, title: true, url: true, channelTitle: true,
        thumbnailUrl: true, publishedAt: true, durationSec: true,
        views: true, likes: true,
      },
    });

    const supportMap = await getSupportPointsMap(from);

    // 急上昇スコア
    const now = Date.now();
    const withScore = candidates.map(v => {
      const published = (v.publishedAt ? new Date(v.publishedAt) : new Date()).getTime();
      const hours = Math.max(1, (now - published) / 3600_000);
      const support = supportMap[v.id] || 0;
      const views = Number(v.views || 0);
      const likes = Number(v.likes || 0);
      const decay = Math.pow(hours / 24, 0.35);
      const score = (support * 1.0 + likes * 0.5 + Math.sqrt(views)) / decay;
      return { ...v, support, score };
    });

    // 並び替え
    let sorted = withScore;
    if (sort === "latest")      sorted = [...withScore].sort((a,b) => Number(b.publishedAt) - Number(a.publishedAt));
    else if (sort === "popular")sorted = [...withScore].sort((a,b) => (b.views || 0) - (a.views || 0));
    else if (sort === "support")sorted = [...withScore].sort((a,b) => b.support - a.support);
    else                        sorted = [...withScore].sort((a,b) => b.score - a.score); // trending

    const total = sorted.length;
    const items = sorted.slice(skip, skip + take);

    return NextResponse.json({ ok: true, meta: { range: label, page, take, total }, items });
  } catch (e: any) {
    console.error("API /api/videos error:", e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
