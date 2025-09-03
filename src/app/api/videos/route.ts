// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ---- helpers ---------------------------------------------------------------
type Range = "1d" | "7d" | "30d";
type ShortsMode = "exclude" | "all";
type SortMode = "trending" | "points";

const DAY = 24 * 60 * 60 * 1000;

function rangeToFrom(range: Range): Date {
  const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * DAY);
}

function parseParams(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") || 1));
  const take = Math.min(48, Math.max(1, Number(sp.get("take") || 24)));
  const range = (sp.get("range") as Range) || "1d";
  const shorts = (sp.get("shorts") as ShortsMode) || "exclude";
  const sort = (sp.get("sort") as SortMode) || "trending";
  return { page, take, range, shorts, sort };
}

/**
 * SupportSnapshot の数値列を動的に検出し、
 * hearts/flames/supporters があれば重みを付けて合計、なければ見つかった数値列を合算。
 * videoId -> points の Map を返す。
 */
async function loadSupportPoints(from: Date): Promise<Record<string, number>> {
  try {
    // 列一覧
    const cols = await prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'SupportSnapshot'
    `;
    if (!cols?.length) return {};

    // 数値カラムだけ残す（id/videoId/createdAt/updatedAt は除外）
    const numericTypes = new Set([
      "integer",
      "smallint",
      "bigint",
      "numeric",
      "real",
      "double precision",
    ]);
    const exclude = new Set(["id", "videoId", "createdAt", "updatedAt"]);
    const present = cols
      .filter((c) => numericTypes.has(c.data_type) && !exclude.has(c.column_name))
      .map((c) => c.column_name);

    if (present.length === 0) return {};

    // よくある列名に重み（無ければ 1）
    const weightOf = (name: string) =>
      name === "hearts" ? 10 : name === "flames" ? 5 : 1;

    // SUM(COALESCE("col",0)*w + ...) を作る
    const terms = present.map((name) =>
      Prisma.sql`COALESCE(${Prisma.raw('"' + name + '"')}, 0) * ${weightOf(name)}`
    );
    const sumExpr = terms.reduce(
      (acc, cur, i) => (i === 0 ? Prisma.sql`${cur}` : Prisma.sql`${acc} + ${cur}`),
      Prisma.sql`0`
    );

    const rows = await prisma.$queryRaw<{ videoId: string; points: number }[]>(
      Prisma.sql`
        SELECT "videoId", SUM(${sumExpr}) AS points
        FROM "SupportSnapshot"
        WHERE "createdAt" >= ${from}
        GROUP BY "videoId"
      `
    );

    const map: Record<string, number> = {};
    for (const r of rows) map[r.videoId] = Number(r.points) || 0;
    return map;
  } catch (e) {
    console.error("[/api/videos] loadSupportPoints failed:", e);
    return {};
  }
}

export async function GET(req: NextRequest) {
  const { page, take, range, shorts, sort } = parseParams(req);
  const from = rangeToFrom(range);

  // 期間 + (ショート排除は AND の中に OR でネスト)
  const AND: Prisma.VideoWhereInput[] = [{ publishedAt: { gte: from } }];

  if (shorts === "exclude") {
    // ロング条件：61秒以上 or URL に /shorts/ を含まない
    AND.push({
      OR: [
        { durationSec: { gte: 61 } },
        { url: { not: { contains: "/shorts/" } } },
      ],
    });
  }

  const where: Prisma.VideoWhereInput = { AND };

  // 大きめに候補を取ってからスコアリング
  const candidates = await prisma.video.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: 600,
    select: {
      id: true,
      title: true,
      url: true,
      platform: true,
      platformVideoId: true,
      thumbnailUrl: true,
      channelTitle: true,
      durationSec: true,
      publishedAt: true,
    },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, items: [], page, take, total: 0 });
  }

  // 期間内応援ポイント
  const supportMap = await loadSupportPoints(from);

  // スコアリング（時間減衰 ^0.35、ロング微ブースト）
  const nowMs = Date.now();
  const scored = candidates.map((v) => {
    const support = supportMap[v.id] ?? 0;
    const pubMs = v.publishedAt ? new Date(v.publishedAt as any).getTime() : nowMs;
    const hours = Math.max(1, (nowMs - pubMs) / (60 * 60 * 1000));
    let score = support / Math.pow(hours / 24, 0.35);
    const isLong = typeof v.durationSec === "number" ? v.durationSec >= 61 : true;
    if (isLong) score *= 1.05;
    return { v, supportInRange: support, score };
  });

  // 並び替え
  scored.sort((a, b) => (sort === "points" ? b.supportInRange - a.supportInRange : b.score - a.score));

  // ランク付与 & ページング
  const ranked = scored.map((x, i) => ({
    ...x.v,
    supportInRange: x.supportInRange,
    trendingRank: i + 1,
  }));
  const total = ranked.length;
  const start = (page - 1) * take;
  const items = ranked.slice(start, start + take).map((v) => ({
    ...v,
    // 古いUI互換のため（スキーマ差異に強くする）
    views: 0,
    likes: 0,
  }));

  return NextResponse.json({ ok: true, items, page, take, total });
}
