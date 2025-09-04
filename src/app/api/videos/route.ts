// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";

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

/**
 * shorts 除外条件:
 * - durationSec が 60 以下は除外
 * - URL に /shorts/ を含むものは除外
 * どちらか一方しか取れないケースもあるので OR ではなく
 * 「60秒より長い」かつ「/shorts/ を含まない」を満たすようにします。
 */
function buildShortsWhere(shorts: Shorts) {
  if (shorts === "exclude") {
    return {
      AND: [
        { OR: [{ durationSec: null }, { durationSec: { gt: 60 } }] },
        { OR: [{ url: { equals: null } }, { url: { not: { contains: "/shorts/" } } }] },
      ],
    };
  }
  return {};
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

  // 共通フィルタ（プラットフォームと shorts 除外）
  const baseWhere: any = {
    platform: { equals: "youtube", mode: "insensitive" },
    ...buildShortsWhere(shorts),
  };

  // --- support 以外の並び ---
  if (sort !== "support") {
    const orderBy =
      sort === "views"
        ? { views: "desc" }
        : { publishedAt: "desc" }; // "trending" / "latest" はとりあえず新しい順

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

    const items = videos.map((v) => ({
      ...v,
      support24h: supportMap.get(v.id) ?? 0,
    }));

    return NextResponse.json(
      { ok: true, items },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // --- 応援順（support） ---
  // 1) 期間内の合計ポイントを videoId ごとに集計（降順）
  const grouped = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
  });

  // 2) shorts 除外など Video 側の条件で videoId をフィルタ
  const topIdsAll = grouped.map((g) => g.videoId);
  if (topIdsAll.length === 0) {
    return NextResponse.json(
      { ok: true, items: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // まとめて該当動画を取り、条件に合わない id を除外
  const candidates = await prisma.video.findMany({
    where: { ...baseWhere, id: { in: topIdsAll } },
    select: { id: true },
  });
  const allowed = new Set(candidates.map((c) => c.id));

  // フィルタ後の id を降順のまま並べ替え
  const sortedAllowedIds = topIdsAll.filter((id) => allowed.has(id));

  // ページング
  const pagedIds = sortedAllowedIds.slice(skip, skip + take);
  if (pagedIds.length === 0) {
    return NextResponse.json(
      { ok: true, items: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // 3) ページ分の Video 情報を取得
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

  // 表示順を pagedIds に合わせる
  const byId = new Map(videosPage.map((v) => [v.id, v]));

  // 4) 期間内合計を map 化（このページで使う id だけ）
  const sumMap = new Map<string, number>();
  for (const g of grouped) {
    if (sumMap.size >= pagedIds.length && !pagedIds.includes(g.videoId)) continue;
    if (pagedIds.includes(g.videoId)) sumMap.set(g.videoId, g._sum.amount ?? 0);
  }

  const items = pagedIds
    .map((id) => byId.get(id))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => ({
      ...v,
      support24h: sumMap.get(v.id) ?? 0,
    }));

  return NextResponse.json(
    { ok: true, items },
    { headers: { "Cache-Control": "no-store" } }
  );
}
