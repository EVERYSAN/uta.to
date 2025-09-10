// src/app/api/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic"; // request.url を触るため静的化不可
const NO_STORE = { "Cache-Control": "no-store" } as const;

type Range = "1d" | "7d" | "30d";
type Sort = "hot" | "new" | "support";
type Shorts = "all" | "exclude" | "only";

function sinceFrom(range: Range): Date {
  const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function shortsFilter(shorts: Shorts) {
  if (shorts === "exclude") return { NOT: { url: { contains: "/shorts/" } } } as const;
  if (shorts === "only") return { url: { contains: "/shorts/" } } as const;
  return {} as const;
}

function buildVideoWhere(q: string, range: Range, shorts: Shorts): Prisma.VideoWhereInput {
  const since = sinceFrom(range);
  const base: Prisma.VideoWhereInput = {
    platform: "youtube",
    publishedAt: { gte: since },
    ...shortsFilter(shorts),
  };
  if (q) {
    base.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { channelTitle: { contains: q, mode: "insensitive" } },
      { url: { contains: q, mode: "insensitive" } },
    ];
  }
  return base;
}

const videoSelect = {
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
} satisfies Prisma.VideoSelect;

export async function GET(req: NextRequest) {
  try {
    const s = req.nextUrl.searchParams;

    const q = (s.get("q") ?? "").trim();
    const range = (s.get("range") as Range) ?? "7d";     // デフォルト7日間（空回避）
    const sort = (s.get("sort") as Sort) ?? "hot";
    const shorts = (s.get("shorts") as Shorts) ?? "all";
    const page = Math.max(1, Number(s.get("page") ?? "1"));
    const take = Math.min(50, Math.max(1, Number(s.get("take") ?? "24")));
    const skip = (page - 1) * take;

    const whereVideo = buildVideoWhere(q, range, shorts);
    const since = sinceFrom(range);

    // --- support 並びのときは SupportEvent 側で groupBy し、その順番で Video を取る ---
    if (sort === "support") {
      // groupBy で _count 降順、Video の条件は relation で適用
      const grouped = await prisma.supportEvent.groupBy({
        by: ["videoId"],
        where: {
          createdAt: { gte: since },
          // relation 経由で Video 側の where を効かせる
          video: whereVideo,
        },
        _count: { videoId: true },
        orderBy: { _count: { videoId: "desc" } },
        skip,
        take,
      });

      const ids = grouped.map(g => g.videoId);
      if (ids.length === 0) {
        return NextResponse.json({ ok: true, items: [], page, take }, { headers: NO_STORE });
      }

      const videos = await prisma.video.findMany({
        where: { id: { in: ids } },
        select: videoSelect,
      });
      const vmap = new Map(videos.map(v => [v.id, v]));
      const items = grouped
        .map(g => {
          const v = vmap.get(g.videoId);
          if (!v) return null;
          return { ...v, supportPoints: g._count.videoId };
        })
        .filter(Boolean);

      return NextResponse.json({ ok: true, items, page, take }, { headers: NO_STORE });
    }

    // --- hot/new のときは Video をDBソートで取得 → supportPoints を期間内 groupBy で合成 ---
    const orderBy =
      sort === "new" ? [{ publishedAt: "desc" as const }] : [{ views: "desc" as const }];

    const videos = await prisma.video.findMany({
      where: whereVideo,
      orderBy,
      skip,
      take,
      select: videoSelect,
    });

    if (videos.length === 0) {
      return NextResponse.json({ ok: true, items: [], page, take }, { headers: NO_STORE });
    }

    const ids = videos.map(v => v.id);
    const support = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { videoId: { in: ids }, createdAt: { gte: since } },
      _count: { videoId: true },
    });

    const supportMap = new Map(support.map(s => [s.videoId, s._count.videoId]));
    const items = videos.map(v => ({ ...v, supportPoints: supportMap.get(v.id) ?? 0 }));

    return NextResponse.json({ ok: true, items, page, take }, { headers: NO_STORE });
  } catch (err) {
    console.error("[/api/search] error:", err);
    return NextResponse.json(
      { ok: false, error: "search_failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}
