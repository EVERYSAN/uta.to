// src/app/api/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

type Range = "1d" | "7d" | "30d";
type Sort = "hot" | "new" | "support";
type Shorts = "all" | "exclude" | "only";

const selectVideo = {
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

const sinceFrom = (range: Range) =>
  new Date(Date.now() - (range === "1d" ? 1 : range === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000);

const shortsFilter = (shorts: Shorts) =>
  shorts === "exclude" ? ({ NOT: { url: { contains: "/shorts/" } } } as const)
  : shorts === "only" ? ({ url: { contains: "/shorts/" } } as const)
  : ({} as const);

function buildVideoWhere(q: string, range: Range, shorts: Shorts): Prisma.VideoWhereInput {
  const where: Prisma.VideoWhereInput = {
    platform: "youtube",
    publishedAt: { gte: sinceFrom(range) },
    ...shortsFilter(shorts),
  };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { channelTitle: { contains: q, mode: "insensitive" } },
      { url: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function GET(req: NextRequest) {
  try {
    const s = req.nextUrl.searchParams;
    const q = (s.get("q") ?? "").trim();
    const range = ((s.get("range") as Range) || "7d") as Range; // 既定7日
    const sort = ((s.get("sort") as Sort) || "hot") as Sort;
    const shorts = ((s.get("shorts") as Shorts) || "all") as Shorts;
    const page = Math.max(1, Number(s.get("page") ?? "1"));
    const take = Math.min(50, Math.max(1, Number(s.get("take") ?? "24")));
    const skip = (page - 1) * take;

    const whereVideo = buildVideoWhere(q, range, shorts);
    const since = sinceFrom(range);

    // support並び：SupportEvent側でgroupBy → その順にVideo取得
    if (sort === "support") {
      const grouped = await prisma.supportEvent.groupBy({
        by: ["videoId"],
        where: { createdAt: { gte: since }, video: whereVideo },
        _count: { videoId: true },
        orderBy: { _count: { videoId: "desc" } },
        skip,
        take,
      });
      if (grouped.length === 0) {
        return NextResponse.json({ ok: true, items: [], page, take }, { headers: NO_STORE });
      }
      const ids = grouped.map(g => g.videoId);
      const videos = await prisma.video.findMany({ where: { id: { in: ids } }, select: selectVideo });
      const vmap = new Map(videos.map(v => [v.id, v]));
      const items = grouped
        .map(g => {
          const v = vmap.get(g.videoId);
          return v ? { ...v, supportPoints: g._count.videoId } : null;
        })
        .filter(Boolean);
      return NextResponse.json({ ok: true, items, page, take }, { headers: NO_STORE });
    }

    // hot/new：VideoをDBソート → 期間内Supportを合成
    const orderBy = sort === "new" ? [{ publishedAt: "desc" as const }] : [{ views: "desc" as const }];
    const videos = await prisma.video.findMany({ where: whereVideo
