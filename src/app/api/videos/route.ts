// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
 * SupportSnapshot の各数値列を JSONB で展開して重み付き合計。
 * - hearts: x10, flames: x5, supporters: x1, その他はそのまま
 * - id/videoId/createdAt/updatedAt は除外
 */
async function loadSupportPoints(from: Date): Promise<Record<string, number>> {
  try {
    const rows = await prisma.$queryRaw<{ videoId: string; points: number }[]>(
      Prisma.sql`
      SELECT s."videoId",
             SUM(
               CASE e.key
                 WHEN 'hearts'      THEN (e.value)::numeric * 10
                 WHEN 'flames'      THEN (e.value)::numeric * 5
                 WHEN 'supporters'  THEN (e.value)::numeric * 1
                 ELSE (e.value)::numeric
               END
             ) AS points
      FROM "SupportSnapshot" s,
           jsonb_each_text( to_jsonb(s) - 'id' - 'videoId' - 'createdAt' - 'updatedAt' ) AS e
      WHERE s."createdAt" >= ${from}
        AND e.value ~ '^-?\\d+(\\.\\d+)?$'
      GROUP BY s."videoId"
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

  // 期間 + ショート排除（AND の中にネスト）
  const AND: Prisma.VideoWhereInput[] = [{ publishedAt: { gte: from } }];
  if (shorts === "exclude") {
    AND.push({
      OR: [{ durationSec: { gte: 61 } }, { url: { not: { contains: "/shorts/" } } }],
    });
  }
  const where: Prisma.VideoWhereInput = { AND };

  // 候補を多めに取得 → メモリでスコアリング
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

  if (!candidates.length) {
    return NextResponse.json({ ok: true, items: [], page, take, total: 0 });
  }

  // 期間内応援ポイント
  const supportMap = await loadSupportPoints(from);

  const nowMs = Date.now();
  const scored = candidates.map((v) => {
    const support = supportMap[v.id] ?? 0;
    const pubMs = v.publishedAt ? new Date(v.publishedAt as any).getTime() : nowMs;
    const hours = Math.max(1, (nowMs - pubMs) / (60 * 60 * 1000));
    let score = support / Math.pow(hours / 24, 0.35); // 時間減衰
    const isLong = typeof v.durationSec === "number" ? v.durationSec >= 61 : true; // 61秒からロング
    if (isLong) score *= 1.05;
    return { v, supportInRange: support, score };
  });

  scored.sort((a, b) => (sort === "points" ? b.supportInRange - a.supportInRange : b.score - a.score));

  const ranked = scored.map((x, i) => ({
    ...x.v,
    supportInRange: x.supportInRange,
    trendingRank: i + 1,
  }));

  const total = ranked.length;
  const start = (page - 1) * take;
  const items = ranked.slice(start, start + take).map((v) => ({
    ...v,
    views: 0,
    likes: 0,
  }));

  return NextResponse.json({ ok: true, items, page, take, total });
}
