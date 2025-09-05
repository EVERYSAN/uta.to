// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // 生成キャッシュを無効化

type Range = "1d" | "7d" | "30d";
type Sort = "trending" | "support";
type Shorts = "all" | "exclude" | "only";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip = (page - 1) * take;

  const range = ((sp.get("range") ?? "1d").toLowerCase() as Range) || "1d";
  const sort = ((sp.get("sort") ?? "trending").toLowerCase() as Sort) || "trending";
  const shorts = ((sp.get("shorts") ?? "all").toLowerCase() as Shorts) || "all";

  const since = sinceFromRange(range);

  // 97と同等の基本フィルタ（プラットフォーム固定＋期間＋ショート条件）
  const videoBaseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // 返却用
  let items:
    Array<{
      id: string;
      platform: "youtube";
      platformVideoId: string;
      title: string;
      url: string;
      thumbnailUrl?: string | null;
      durationSec?: number | null;
      publishedAt?: Date | null;
      channelTitle?: string | null;
      views?: number | null;
      likes?: number | null;
      // 追加フィールド
      supportPoints?: number;
      supportRank?: number;
    }> = [];

  if (sort === "support") {
    // ▼ 応援順：SupportEvent を期間内で groupBy → _count 多い順でページング
    // Prisma では _count._all での orderBy がタイプエラーになる版があるため、
    // videoId の _count を使って並べ替え（本質は同じ）
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        createdAt: { gte: since },
        // SupportEvent 側から Video へリレーションがある前提（schema の `video`）
        video: { is: videoBaseWhere },
      },
      _count: { videoId: true },
      orderBy: { _count: { videoId: "desc" } },
      skip,
      take,
    });

    const ids = grouped.map((g) => g.videoId);
    if (ids.length > 0) {
      const videos = await prisma.video.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          platform: true,
          platformVideoId: true,
          title: true,
          url: true,
          thumbnailUrl: true,
          durationSec: true,
          publishedAt: true,
          views: true,
          likes: true,
          channelTitle: true,
        },
      });
      const vmap = new Map(videos.map((v) => [v.id, v]));
      items = ids.map((id, i) => {
        const v = vmap.get(id)!;
        const c = grouped[i]?._count.videoId ?? 0;
        return { ...v, supportPoints: c, supportRank: skip + i + 1 };
      });
    }
  } else {
    // ▼ 急上昇/新着：Video を DB 並びで取得 → 表示分だけ期間内 Support を集計して合成
    let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
    if (sort === "trending") {
      // いまは views desc。将来 trendingScore を持つならここで切替
      orderBy = { views: "desc" };
    }
    // もしクエリで sort=new が来た場合も後方互換で対応
    if (sp.get("sort")?.toLowerCase() === "new") {
      orderBy = { publishedAt: "desc" };
    }

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
        url: true,
        thumbnailUrl: true,
        durationSec: true,
        publishedAt: true,
        views: true,
        likes: true,
        channelTitle: true,
      },
    });

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

    items = videos.map((v) => ({
      ...v,
      supportPoints: supportMap.get(v.id) ?? 0,
    }));
  }

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/* ---------- helpers ---------- */

function sinceFromRange(range: string | null): Date {
  const now = Date.now();
  const ms =
    range === "1d"
      ? 24 * 60 * 60 * 1000
      : range === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms);
}

function buildShortsWhere(shorts: string | null): Prisma.VideoWhereInput | {} {
  if (shorts === "exclude") {
    return { NOT: { url: { contains: "/shorts/" } } };
  }
  if (shorts === "only") {
    return { url: { contains: "/shorts/" } };
  }
  return {};
}
