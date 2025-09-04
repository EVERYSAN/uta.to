// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Range = "1d" | "7d" | "30d";
type Shorts = "all" | "exclude";
type Sort = "trending" | "latest" | "views" | "support";

function sinceFromRange(range: Range): Date {
  switch (range) {
    case "7d":
      return dayjs().subtract(7, "day").toDate();
    case "30d":
      return dayjs().subtract(30, "day").toDate();
    case "1d":
    default:
      return dayjs().subtract(1, "day").toDate();
  }
}

/** shorts=exclude のときの where を Prisma 型で返す（readonly を避ける） */
function buildShortsWhere(shorts: Shorts): Prisma.VideoWhereInput {
  if (shorts !== "exclude") return {};
  const and: Prisma.VideoWhereInput[] = [
    { OR: [{ durationSec: null }, { durationSec: { gt: 60 } }] },
    { NOT: { url: { contains: "/shorts/" } } },
  ];
  return { AND: and };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const range = (url.searchParams.get("range") as Range) || "1d";
  const shorts = (url.searchParams.get("shorts") as Shorts) || "all";
  const sort = (url.searchParams.get("sort") as Sort) || "trending";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const take = Math.min(50, Math.max(1, Number(url.searchParams.get("take") || 24)));
  const skip = (page - 1) * take;

  const since = sinceFromRange(range);

  // 共通 where
  const baseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...buildShortsWhere(shorts),
  };

  // ------- support 以外の並び -------
  if (sort !== "support") {
    let orderBy: Prisma.VideoOrderByWithRelationInput;
    if (sort === "views") {
      orderBy = { views: "desc" };
    } else {
      // 'trending' / 'latest' は新しい順
      orderBy = { publishedAt: "desc" };
    }

    const videos = await prisma.video.findMany({
      where: baseWhere,
      orderBy,
      skip,
      take,
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
        supportPoints: true,
      },
    });

    // 直近期間の応援合計を付与
    const sums = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { createdAt: { gte: since }, videoId: { in: videos.map((v) => v.id) } },
      _sum: { amount: true },
    });
    const supportMap = new Map(sums.map((g) => [g.videoId, g._sum.amount ?? 0]));
    const items = videos.map((v) => ({ ...v, support24h: supportMap.get(v.id) ?? 0 }));

    return NextResponse.json(
      { ok: true, items },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // ------- 応援順（期間合計で降順） -------
  const grouped = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
  });

  const topIdsAll = grouped.map((g) => g.videoId);
  if (topIdsAll.length === 0) {
    return NextResponse.json({ ok: true, items: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  // Video 側条件で id を間引く
  const candidates = await prisma.video.findMany({
    where: { ...baseWhere, id: { in: topIdsAll } },
    select: { id: true },
  });
  const allowed = new Set(candidates.map((c) => c.id));
  const sortedAllowedIds = topIdsAll.filter((id) => allowed.has(id));

  // ページング
  const pagedIds = sortedAllowedIds.slice(skip, skip + take);
  if (pagedIds.length === 0) {
    return NextResponse.json({ ok: true, items: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const videosPage = await prisma.video.findMany({
    where: { id: { in: pagedIds } },
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
      supportPoints: true,
    },
  });

  const byId = new Map(videosPage.map((v) => [v.id, v]));

  // このページで必要な合計だけ map 化
  const need = new Set(pagedIds);
  const sumMap = new Map<string, number>();
  for (const g of grouped) {
    if (need.has(g.videoId)) sumMap.set(g.videoId, g._sum.amount ?? 0);
  }

  const items = pagedIds
    .map((id) => byId.get(id))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => ({ ...v, support24h: sumMap.get(v.id) ?? 0 }));

  return NextResponse.json(
    { ok: true, items },
    { headers: { "Cache-Control": "no-store" } }
  );
}
