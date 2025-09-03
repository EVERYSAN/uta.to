import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function parseFrom(range: string | null): Date {
  const now = Date.now();
  switch ((range ?? "").toLowerCase()) {
    case "24h":
    case "1d":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case "7d":
    default:
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
  }
}

function longShortWhere(shorts: string | null) {
  const mode = (shorts ?? "all").toLowerCase();
  if (mode === "exclude") {
    return {
      OR: [
        { durationSec: { gte: 61 } },
        {
          AND: [
            { durationSec: null },
            { NOT: { url: { contains: "/shorts/" } } },
          ],
        },
      ],
    };
  }
  if (mode === "only") {
    return {
      OR: [
        { durationSec: { lte: 60 } },
        { url: { contains: "/shorts/" } },
      ],
    };
  }
  return {};
}

type SupportSums = Record<
  string,
  { hearts: number; flames: number; supporters: number; points: number }
>;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = parseFrom(searchParams.get("range"));
    const shorts = searchParams.get("shorts"); // exclude | only | all
    const sort = (searchParams.get("sort") ?? "points").toLowerCase(); // points | newest
    const take = Math.min(Number(searchParams.get("take") ?? 30), 60);

    // 1) まず期間内の動画候補を取得（ショート/ロングのフィルタもここでかける）
    const videos = await prisma.video.findMany({
      where: { publishedAt: { gte: from }, ...longShortWhere(shorts) },
      orderBy: sort === "newest" ? { publishedAt: "desc" } : { publishedAt: "desc" },
      take,
      select: {
        id: true,
        platform: true,
        platformVideoId: true,
        title: true,
        url: true,
        thumbnailUrl: true,
        channelTitle: true,
        publishedAt: true,
        durationSec: true,
      },
    });

    if (videos.length === 0) return NextResponse.json([]);

    // 2) 期間内の応援スナップショットを videoId ごとに集計してマージ
    const ids = videos.map(v => v.id);
    const grouped = (await (prisma as any).supportSnapshot.groupBy({
      by: ["videoId"],
      where: { createdAt: { gte: from }, videoId: { in: ids } },
      _sum: { hearts: true, flames: true, supporters: true },
    })) as Array<{
      videoId: string;
      _sum: { hearts: number | null; flames: number | null; supporters: number | null };
    }>;

    const sums: SupportSums = {};
    for (const row of grouped) {
      const h = row._sum.hearts ?? 0;
      const f = row._sum.flames ?? 0;
      const s = row._sum.supporters ?? 0;
      const pts = h + f * 3 + s * 5;
      sums[row.videoId] = { hearts: h, flames: f, supporters: s, points: pts };
    }

    const withSupport = videos.map(v => ({
      ...v,
      support: sums[v.id] ?? { hearts: 0, flames: 0, supporters: 0, points: 0 },
    }));

    if (sort === "points") {
      withSupport.sort((a, b) => (b.support.points ?? 0) - (a.support.points ?? 0));
    }

    return NextResponse.json(withSupport);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
