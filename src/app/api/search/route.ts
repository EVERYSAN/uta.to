// src/app/api/search/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // 静的最適化の対象外にする（request.url を使うため）

// q=検索語 / range=1d|7d|30d / sort=hot|new|support / shorts=all|exclude|only
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const q = (sp.get("q") ?? "").trim();
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip = (page - 1) * take;

  const range = (sp.get("range") ?? "1d").toLowerCase();
  const sort = (sp.get("sort") ?? "hot").toLowerCase();
  const shorts = (sp.get("shorts") ?? "all").toLowerCase();

  const since = sinceFromRange(range);

  // 検索条件（Video 側）
  const videoWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // support 並びは SupportEvent を集計して ID を並べ、後から Video を取り込む
  if (sort === "support") {
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        ...(since ? { createdAt: { gte: since } } : {}),
        // 検索条件を Video リレーションで絞る
        video: { is: videoWhere },
      },
      _count: { videoId: true },                // ← 型エラー原因。必須
      orderBy: { _count: { videoId: "desc" } }, // 件数の多い順
      skip,
      take,
    });

    const ids = grouped.map(g => g.videoId);
    const videos = await prisma.video.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, platform: true, platformVideoId: true, title: true,
        channelTitle: true, url: true, thumbnailUrl: true, durationSec: true,
        publishedAt: true, views: true, likes: true,
      },
    });
    const vmap = new Map(videos.map(v => [v.id, v]));

    const items = ids.map((id, i) => {
      const v = vmap.get(id)!;
      const count = grouped[i]?._count?.videoId ?? 0;
      return { ...v, supportPoints: count, supportRank: skip + i + 1 };
    });

    return NextResponse.json(
      { ok: true, items, page, take },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // それ以外の並びは Video を直接取得してから、当該ページ分の SupportEvent を集計
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" }; // hot
  if (sort === "new") orderBy = { publishedAt: "desc" };

  const videos = await prisma.video.findMany({
    where: videoWhere,
    orderBy,
    skip,
    take,
    select: {
      id: true, platform: true, platformVideoId: true, title: true,
      channelTitle: true, url: true, thumbnailUrl: true, durationSec: true,
      publishedAt: true, views: true, likes: true,
    },
  });

  const ids = videos.map(v => v.id);
  let supportMap = new Map<string, number>();

  if (ids.length > 0) {
    const counts = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: ids },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { videoId: true }, // ここも明示
    });
    supportMap = new Map(counts.map(g => [g.videoId, g._count?.videoId ?? 0]));
  }

  const items = videos.map(v => ({
    ...v,
    supportPoints: supportMap.get(v.id) ?? 0,
  }));

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/* helpers */
function sinceFromRange(range: string | null): Date {
  const now = Date.now();
  const ms =
    range === "1d" ? 24 * 60 * 60 * 1000 :
    range === "7d" ? 7  * 24 * 60 * 60 * 1000 :
                      30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms);
}

function buildShortsWhere(shorts: string | null): Prisma.VideoWhereInput | {} {
  if (shorts === "exclude") return { NOT: { url: { contains: "/shorts/" } } };
  if (shorts === "only")    return {      url: { contains: "/shorts/" }   };
  return {};
}
