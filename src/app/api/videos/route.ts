import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type SortKey = "new" | "old" | "views" | "likes" | "trending";
type PeriodKey = "day" | "week" | "month";

const HARD_CAP = 1000; // トレンド算出は最大1000件の候補でメモリソート

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q")?.trim() ?? "";
  const sort = (searchParams.get("sort") ?? "new") as SortKey;
  const period = (searchParams.get("period") ?? "day") as PeriodKey;

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") ?? "50", 10)));
  const skip = (page - 1) * take;

  const where =
    q.length > 0
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { channelTitle: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : undefined;

  // 既存の並び（new/old/views/likes）は Prisma の orderBy でそのまま
  if (sort !== "trending") {
    const orderBy =
      sort === "old"
        ? { publishedAt: "asc" as const }
        : sort === "views"
        ? { views: "desc" as const }
        : sort === "likes"
        ? { likes: "desc" as const }
        : { publishedAt: "desc" as const }; // "new"

    const [items, total] = await Promise.all([
      prisma.video.findMany({
        where,
        orderBy,
        take,
        skip,
        select: {
          id: true,
          platform: true,
          platformVideoId: true,
          title: true,
          url: true,
          thumbnailUrl: true,
          durationSec: true,
          publishedAt: true,
          channelTitle: true,
          views: true,
          likes: true,
        },
      }),
      prisma.video.count({ where }),
    ]);

    return NextResponse.json({
      ok: true,
      total,
      page,
      take,
      items: items.map((v) => ({ ...v, publishedAt: v.publishedAt.toISOString() })),
    });
  }

  // ===== 急上昇：スナップショットを使って“伸び”でスコアリング =====
  const now = new Date();
  const days = period === "week" ? 7 : period === "month" ? 30 : 1;

  // 期間の基準日(UTC 00:00)
  const baselineDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, 0, 0, 0, 0)
  );

  // 候補は最大1000件（無料枠/パフォーマンス配慮）
  const candidates = await prisma.video.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: HARD_CAP,
    select: {
      id: true,
      platform: true,
      platformVideoId: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      durationSec: true,
      publishedAt: true,
      channelTitle: true,
      views: true,
      likes: true,
    },
  });

  const ids = candidates.map((v) => v.id);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, total: 0, page, take, items: [] });
  }

  // 基準日の記録を取得（存在しない動画は 0 扱い）
  const prev = await prisma.videoMetric.findMany({
    where: { videoId: { in: ids }, date: baselineDate },
    select: { videoId: true, views: true, likes: true },
  });
  const prevMap = new Map(prev.map((m) => [m.videoId, m]));

  // スコア：Δviews + 10*Δlikes + 新しさ微加点
  const scored = candidates.map((v) => {
    const p = prevMap.get(v.id);
    const dv = Math.max(0, (v.views ?? 0) - (p?.views ?? 0));
    const dl = Math.max(0, (v.likes ?? 0) - (p?.likes ?? 0));
    const ageHours = (now.getTime() - v.publishedAt.getTime()) / 36e5;
    const recencyBoost = Math.exp(-ageHours / 72); // 3日で1/e
    const score = dv + 10 * dl + 50 * recencyBoost;
    return { v, score, dv, dl };
  });

  scored.sort((a, b) => b.score - a.score);

  const total = scored.length;
  const pageItems = scored.slice(skip, skip + take).map((s) => ({
    ...s.v,
    publishedAt: s.v.publishedAt.toISOString(),
    trending: {
      period,
      score: Math.round(s.score),
      deltaViews: s.dv,
      deltaLikes: s.dl,
    },
  }));

  return NextResponse.json({ ok: true, total, page, take, items: pageItems });
}
