// src/lib/trending.ts
import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import tz from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(tz);

type Range = "1d" | "7d" | "30d";
const JST = "Asia/Tokyo";

function sinceOf(range: Range) {
  const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
  return dayjs().tz(JST).subtract(days, "day").toDate();
}

/**
 * 一覧で使う動画 + 期間内の応援ポイント（support24h など）を付与し、
 * スコアで並べ替えて返す
 */
export async function fetchTrendingWithSupport(
  range: Range,
  shorts: "all" | "exclude" = "all",
) {
  const since = sinceOf(range);

  // 期間内の応援ポイントを videoId ごとに集計
  const grouped = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
  });
  const supportMap = new Map(grouped.map(g => [g.videoId, g._sum.amount ?? 0]));

  // 一覧に出す動画（必要な項目だけ）
  const videos = await prisma.video.findMany({
    where: {
      ...(shorts === "exclude" ? { durationSec: { gte: 60 } } : {}),
    },
    select: {
      id: true,
      title: true,
      channelTitle: true,
      url: true,
      thumbnailUrl: true,
      publishedAt: true,
      views: true,
      likes: true,
      durationSec: true,
    },
    take: 120, // 適宜
  });

  // スコア（例）= 応援 * 50 + いいね * 3 + 再生 * 0.001
  const withScore = videos.map(v => {
    const support = supportMap.get(v.id) ?? 0;
    const score =
      support * 50 + (v.likes ?? 0) * 3 + (v.views ?? 0) * 0.001;
    return { ...v, support, score };
  });

  withScore.sort((a, b) => b.score - a.score);
  return withScore;
}
