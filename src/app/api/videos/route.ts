// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // 生成キャッシュ無効化

// range=1d|7d|30d, sort=trending|support, shorts=all|exclude
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const page  = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take  = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip  = (page - 1) * take;

  const range  = (sp.get("range")  ?? "1d").toLowerCase();
  const sort   = (sp.get("sort")   ?? "trending").toLowerCase();
  const shorts = (sp.get("shorts") ?? "all").toLowerCase();

  const since = sinceFromRange(range);

  // 動画テーブルへの共通フィルタ
  const videoBaseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // --- 応援順（期間内のSupportEvent件数で降順） ---
  if (sort === "support") {
    // まずSupportEventを videoId ごとに件数集計（期間・ショートは video のリレーションで絞る）
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        createdAt: { gte: since },
        video: { is: videoBaseWhere },
      },
      // orderBy は型が厳しいので JS 側で並べ替える
      _count: { videoId: true },
    });

    // 件数で降順に並べ替え → ページング
    grouped.sort((a, b) => (b._count.videoId || 0) - (a._count.videoId || 0));
    const total = grouped.length;
    const pageIds = grouped.slice(skip, skip + take).map(g => g.videoId);
    const countMap = new Map(grouped.map(g => [g.videoId, g._count.videoId ?? 0]));

    // ページ分の動画を一括取得（順序保持のため後で並べ替え）
    const videos = await prisma.video.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true,
        platform: true,
        platformVideoId: true,
        title: true,
        channelTitle: true,
        url: true,
        thumbnailUrl: true,
        durationSec: true,
        publishedAt: true,
        views: true,
        likes: true,
      },
    });
    const vmap = new Map(videos.map(v => [v.id, v]));

    // pageIds の順に並べ直し、supportPoints / supportRank を付与
    const items = pageIds.map((id, idx) => {
      const v = vmap.get(id)!;
      return {
        ...v,
        platform: "youtube" as const, // 型エラー回避（文字列リテラルに固定）
        supportPoints: countMap.get(id) ?? 0,
        supportRank: skip + idx + 1,
      };
    });

    return NextResponse.json(
      { ok: true, items, page, take, total },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // --- 急上昇（例: 再生数降順 / 新着） ---
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
  if (sort === "new") orderBy = { publishedAt: "desc" };

  const videos = await prisma.video.findMany({
    where: videoBaseWhere,
    orderBy,
    skip,
    take,
    select: {
      id: true,
      platform: true,
      platformVideoId: true,
      title: true,
      channelTitle: true,
      url: true,
      thumbnailUrl: true,
      durationSec: true,
      publishedAt: true,
      views: true,
      likes: true,
    },
  });

  // 表示中の動画についてのみ、期間内のSupportEvent件数を集計
  const ids = videos.map(v => v.id);
  let supportMap = new Map<string, number>();
  if (ids.length > 0) {
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { videoId: { in: ids }, createdAt: { gte: since } },
      _count: { videoId: true },
    });
    supportMap = new Map(grouped.map(g => [g.videoId, g._count.videoId ?? 0]));
  }

  // カード表示用フィールドを合成（ページ内順位を trendingRank として付与）
  const items = videos.map((v, i) => ({
    ...v,
    platform: "youtube" as const,
    supportPoints: supportMap.get(v.id) ?? 0,
    trendingRank: skip + i + 1,
  }));

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// ============ helpers ============
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
  if (shorts === "only")    return {      url: { contains: "/shorts/" } };
  return {};
}
