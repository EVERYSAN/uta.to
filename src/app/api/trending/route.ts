// src/app/api/trending/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const revalidate = 0;

const prisma = new PrismaClient();

function rangeToFrom(range: string | null): Date {
  const now = new Date();
  switch ((range ?? "24h").toLowerCase()) {
    case "24h":
    case "1d":
      return new Date(now.getTime() - 24 * 3600_000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 3600_000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 3600_000);
    default:
      return new Date(now.getTime() - 24 * 3600_000);
  }
}

function buildLongOnlyWhere(searchParams: URLSearchParams): Prisma.VideoWhereInput | undefined {
  if (searchParams.get("shorts") !== "exclude") return undefined;
  return {
    AND: [
      { url: { not: { contains: "/shorts/" } } },
      { durationSec: { gte: 61 } },
    ],
  };
}

type SupportSums = Record<
  string,
  { hearts: number; flames: number; supporters: number; points: number }
>;

async function loadSupportSums(videoIds: string[], from: Date): Promise<SupportSums> {
  const rows = await prisma.supportSnapshot.findMany({
    where: {
      videoId: { in: videoIds },
      createdAt: { gte: from },
    },
    select: { videoId: true, hearts: true, flames: true, supporters: true },
  });

  const map: SupportSums = {};
  for (const id of videoIds) {
    map[id] = { hearts: 0, flames: 0, supporters: 0, points: 0 };
  }
  for (const r of rows) {
    const cur = map[r.videoId] ?? { hearts: 0, flames: 0, supporters: 0, points: 0 };
    cur.hearts += r.hearts ?? 0;
    cur.flames += r.flames ?? 0;
    cur.supporters += r.supporters ?? 0;
    cur.points = cur.hearts + cur.flames * 3;
    map[r.videoId] = cur;
  }
  for (const id of Object.keys(map)) {
    const v = map[id];
    v.points = (v.hearts ?? 0) + (v.flames ?? 0) * 3;
  }
  return map;
}

/** 急上昇スコア：応援ポイントを時間減衰。ロングに微ブースト。 */
function calcTrendScore(points: number, publishedAt: Date | null, isLong: boolean, now = new Date()) {
  const ageHours = Math.max(
    1,
    (now.getTime() - (publishedAt ? new Date(publishedAt).getTime() : 0)) / 3600_000
  );
  const decay = Math.pow(ageHours / 24, 0.35); // 新しいほど有利
  const longBoost = isLong ? 1.05 : 1.0;       // ロングに微ブースト（維持）
  return (points / decay) * longBoost;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = rangeToFrom(searchParams.get("range"));
    const longOnlyWhere = buildLongOnlyWhere(searchParams);

    const where: Prisma.VideoWhereInput = {
      publishedAt: { gte: from },
      ...(longOnlyWhere ?? {}),
    };

    const videos = await prisma.video.findMany({
      where,
      select: {
        id: true,
        title: true,
        url: true,
        thumbnailUrl: true,
        channelTitle: true,
        publishedAt: true,
        durationSec: true,
        views: true,
        likes: true,
      },
      orderBy: { publishedAt: "desc" },
      take: 500,
    });

    const sums = await loadSupportSums(
      videos.map((v) => v.id),
      from
    );

    const now = new Date();
    const ranked = videos
      .map((v) => {
        const s = sums[v.id] ?? { hearts: 0, flames: 0, supporters: 0, points: 0 };
        const isLong = (v.durationSec ?? 0) >= 61;
        const trendScore = calcTrendScore(s.points, v.publishedAt, isLong, now);
        return {
          id: v.id,
          title: v.title,
          url: v.url,
          thumbnailUrl: v.thumbnailUrl,
          channelTitle: v.channelTitle,
          publishedAt: v.publishedAt,
          durationSec: v.durationSec,
          views: v.views ?? 0,
          likes: v.likes ?? 0,
          support: s,
          trendScore,
        };
      })
      // 応援 0 の動画も含めつつ、スコアで並べる
      .sort((a, b) => b.trendScore - a.trendScore);

    return NextResponse.json({
      ok: true,
      range: searchParams.get("range") ?? "24h",
      shorts: searchParams.get("shorts") ?? "include",
      total: ranked.length,
      videos: ranked,
    });
  } catch (err: any) {
    console.error("GET /api/trending failed", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
