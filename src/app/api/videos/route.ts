// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// range=1d|7d|30d  sort=trending|new|support  shorts=all|exclude
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const page  = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take  = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip  = (page - 1) * take;

  const range  = (sp.get("range")  ?? "1d").toLowerCase();
  const sort   = (sp.get("sort")   ?? "trending").toLowerCase();
  const shorts = (sp.get("shorts") ?? "all").toLowerCase();

  /** 期間境界（表示用/集計用に常に計算） */
  const since = sinceFromRange(range);

  /** 97と同等のショート条件 */
  function buildShortsWhere(s: string): Prisma.VideoWhereInput | {} {
    if (s === "exclude") return { NOT: { url: { contains: "/shorts/" } } };
    if (s === "only")    return { url: { contains: "/shorts/" } }; // 使わないが互換で残す
    return {};
  }

  /** 動画側の基本 where（プラットフォーム固定＋期間＋ショート条件） */
  const videoBaseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // ============ 応援順 ============
  if (sort === "support") {
    // SupportEvent を期間内で集計 → 件数の多い順でページング
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        createdAt: { gte: since },
        // 動画側の条件も担保（ショート除外や公開日など）
        video: { is: videoBaseWhere },
      },
      _count: { videoId: true },
      orderBy: { _count: { videoId: "desc" } },
      skip,
      take,
    });

    const ids = grouped.map((g) => g.videoId);
    if (ids.length === 0) {
      return NextResponse.json(
        { ok: true, items: [], page, take },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // まとめて動画情報を取得して Map 化
    const videos = await prisma.video.findMany({
      where: { id: { in: ids } },
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
    const vmap = new Map(videos.map((v) => [v.id, v]));

    const items = grouped
      .map((g, i) => {
        const v = vmap.get(g.videoId);
        if (!v) return null;
        return {
          ...v,
          // 期間内応援件数をカードで出す
          supportPoints: g._count.videoId,
          // 応援順の順位（1始まり）
          supportRank: skip + i + 1,
        };
      })
      .filter(Boolean);

    return NextResponse.json(
      { ok: true, items, page, take },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // ============ 急上昇 / 新着 ============
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" }; // trending 既定
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

  // 表示されるIDだけ対象に、期間内 SupportEvent を件数集計
  const ids = videos.map((v) => v.id);
  let supportMap = new Map<string, number>();
  if (ids.length > 0) {
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: ids },
        createdAt: { gte: since },
      },
      _count: { videoId: true },
    });
    supportMap = new Map(grouped.map((g) => [g.videoId, g._count.videoId]));
  }

  const items = videos.map((v) => ({
    ...v,
    supportPoints: supportMap.get(v.id) ?? 0, // バッジ表示用
  }));

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/* ===== helpers ===== */
function sinceFromRange(range: string | null): Date {
  const now = Date.now();
  const ms =
    range === "1d" ? 1 * 24 * 60 * 60 * 1000 :
    range === "7d" ? 7 * 24 * 60 * 60 * 1000 :
                     30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms);
}
