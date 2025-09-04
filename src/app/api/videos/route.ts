// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // 生成キャッシュは常に無効化

type SortParam = "trending" | "support" | "hot" | "new";
type RangeParam = "1d" | "7d" | "30d";
type ShortsParam = "all" | "exclude" | "only";

// 期間境界
function sinceFromRange(range: RangeParam | string | null): Date {
  const now = Date.now();
  const ms =
    range === "1d" ? 24 * 60 * 60 * 1000 :
    range === "7d" ? 7  * 24 * 60 * 60 * 1000 :
                     30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms);
}

// shorts フィルタ
function buildShortsWhere(shorts: ShortsParam | string | null): Prisma.VideoWhereInput {
  if (shorts === "exclude") return { NOT: { url: { contains: "/shorts/" } } };
  if (shorts === "only")    return { url: { contains: "/shorts/" } };
  return {};
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const page  = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take  = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip  = (page - 1) * take;

  const range  = (sp.get("range")  ?? "1d").toLowerCase() as RangeParam;
  const sort   = (sp.get("sort")   ?? "trending").toLowerCase() as SortParam;
  const shorts = (sp.get("shorts") ?? "all").toLowerCase() as ShortsParam;

  const since = sinceFromRange(range);

  // 動画側の共通 where
  const videoBaseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    publishedAt: { gte: since },
    ...buildShortsWhere(shorts),
  };

  // ========== 応援順：SupportEvent を期間で groupBy して直に並べ替え ==========
  if (sort === "support") {
    // SupportEvent を videoId ごとに集計・並び替え（期間・動画条件を満たすもの）
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        createdAt: { gte: since },
        // 関連の Video 側にフィルタを適用
        video: { is: videoBaseWhere },
      },
      orderBy: { _count: { videoId: "desc" } },
      skip,
      take,
    });

    const ids = grouped.map(g => g.videoId);
    if (ids.length === 0) {
      return NextResponse.json(
        { ok: true, items: [], page, take },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 取得した id の動画本体をまとめて取る
    const videos = await prisma.video.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, platform: true, platformVideoId: true, title: true,
        channelTitle: true, url: true, thumbnailUrl: true, durationSec: true,
        publishedAt: true, views: true, likes: true,
      },
    });

    // 順序維持のためマップ化 → groupBy の順に整列
    const byId = new Map(videos.map(v => [v.id, v]));
    const items = ids.map((id, i) => {
      const v = byId.get(id);
      const points = (grouped[i] as any)?._count?._all ?? 0;
      return v
        ? { ...v, supportPoints: points, supportRank: skip + i + 1 }
        : null;
    }).filter(Boolean);

    return NextResponse.json(
      { ok: true, items, page, take },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // ========== 急上昇/新着：従来通り DB ソート ==========
  const orderBy: Prisma.VideoOrderByWithRelationInput =
    sort === "new" || sort === "hot" ? { publishedAt: "desc" } : { views: "desc" };

  const videos = await prisma.video.findMany({
    where: videoBaseWhere,
    orderBy,
    skip,
    take,
    select: {
      id: true, platform: true, platformVideoId: true, title: true,
      channelTitle: true, url: true, thumbnailUrl: true, durationSec: true,
      publishedAt: true, views: true, likes: true,
    },
  });

  // 表示用：同じ期間で SupportEvent を件数集計 → 合成（一覧の補助情報）
  let supportMap = new Map<string, number>();
  if (videos.length) {
    const ids = videos.map(v => v.id);
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { videoId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    supportMap = new Map(grouped.map(g => [g.videoId, (g as any)._count._all as number]));
  }

  const items = videos.map(v => ({
    ...v,
    supportPoints: supportMap.get(v.id) ?? 0,
  }));

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}
