import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/** range=1d|24h|7d|30d → Date */
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

/** shorts=exclude|only|all */
function longShortWhere(shorts: string | null) {
  const mode = (shorts ?? "all").toLowerCase();
  if (mode === "exclude") {
    // ロングのみ（61秒以上 or shorts URL でない）
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
    // ショートのみ（60秒以下 or shorts URL）
    return {
      OR: [
        { durationSec: { lte: 60 } },
        { url: { contains: "/shorts/" } },
      ],
    };
  }
  return {}; // すべて
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
    const take = Math.min(Number(searchParams.get("take") ?? 24), 60);

    // 1) 期間内のスナップショットを videoId ごとに集計
    const grouped = (await (prisma as any).supportSnapshot.groupBy({
      by: ["videoId"],
      where: { createdAt: { gte: from } },
      _sum: { hearts: true, flames: true, supporters: true },
    })) as Array<{
      videoId: string;
      _sum: { hearts: number | null; flames: number | null; supporters: number | null };
    }>;

    // スコア用のマップ
    const sums: SupportSums = {};
    for (const row of grouped) {
      const h = row._sum.hearts ?? 0;
      const f = row._sum.flames ?? 0;
      const s = row._sum.supporters ?? 0;
      const pts = h + f * 3 + s * 5; // 重みは以前と同等のイメージ
      sums[row.videoId] = { hearts: h, flames: f, supporters: s, points: pts };
    }

    // 集計に登場した動画だけを取得（短尺/長尺フィルタを適用）
    const videoIds = Object.keys(sums);
    if (videoIds.length === 0) {
      // 応援がまだ無いケース：期間内の最新を返す（空表示対策）
      const fallback = await prisma.video.findMany({
        where: {
          publishedAt: { gte: from },
          ...longShortWhere(shorts),
        },
        orderBy: { publishedAt: "desc" },
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
      return NextResponse.json(
        fallback.map(v => ({
          ...v,
          support: { hearts: 0, flames: 0, supporters: 0, points: 0 },
          trendScore: 0,
        }))
      );
    }

    const videos = await prisma.video.findMany({
      where: { id: { in: videoIds }, ...longShortWhere(shorts) },
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

    // 2) 急上昇スコアの算出（時間減衰 & ロング微ブースト）
    const now = Date.now();
    const enriched = videos.map(v => {
      const sup = sums[v.id] ?? { hearts: 0, flames: 0, supporters: 0, points: 0 };
      const hours = Math.max(
        1,
        v.publishedAt ? (now - new Date(v.publishedAt).getTime()) / 3_600_000 : 24
      );
      const longBoost =
        (v.durationSec ?? 0) >= 61 || (v.durationSec == null && !v.url?.includes("/shorts/"))
          ? 1.05
          : 1.0;
      const trendScore = (sup.points / Math.pow(hours / 24, 0.35)) * longBoost;

      return { ...v, support: sup, trendScore };
    });

    // 3) スコア順に並べて返す
    enriched.sort((a, b) => b.trendScore - a.trendScore);
    return NextResponse.json(enriched.slice(0, take));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
