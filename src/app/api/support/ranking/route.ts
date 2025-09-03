import prisma from "@/lib/prisma";
import { rangeToSince } from "@/lib/support";

/**
 * 応援ポイント ランキングAPI
 * GET /api/support/ranking?range=1d|7d|30d&take=50
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const range = (url.searchParams.get("range") as "1d" | "7d" | "30d") || "7d";
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || 50)));
  const since = rangeToSince(range);

  // 期間内のSupportEventを集計
  const groups = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take,
  });

  const ids = groups.map((g) => g.videoId);
  if (!ids.length) return Response.json({ ok: true, items: [] });

  const videos = await prisma.video.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      durationSec: true,
      publishedAt: true,
      channelTitle: true,
      views: true,
      likes: true,
      supportPoints: true,
    },
  });

  const vById = new Map(videos.map((v) => [v.id, v]));
  const items = groups
    .map((g) => {
      const v = vById.get(g.videoId);
      if (!v) return null;
      return { ...v, points: g._sum.amount ?? 0 };
    })
    .filter(Boolean);

  return Response.json({ ok: true, items });
}
