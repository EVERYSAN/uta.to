// src/app/api/search/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // キャッシュ無効

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const q = (sp.get("q") ?? "").trim();
  const range = (sp.get("range") ?? "1d").toLowerCase(); // 1d|7d|30d
  const shorts = (sp.get("shorts") ?? "all").toLowerCase(); // all|exclude|only
  const sort = (sp.get("sort") ?? "hot").toLowerCase(); // hot|new|support

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip = (page - 1) * take;

  const since = sinceFromRange(range);

  const whereBase: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { channelTitle: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  let items: any[] = [];

  // --- 応援順：期間内 SupportEvent を videoId ごとに件数集計して順序を作る ---
  if (sort === "support") {
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        createdAt: { gte: since },
        video: { is: whereBase }, // 連結条件（検索/期間/ショート）
      },
      orderBy: { _count: { videoId: "desc" } },
      skip,
      take,
    });

    const ids = grouped.map((g) => g.videoId);
    if (ids.length > 0) {
      const videos = await prisma.video.findMany({
        where: { id: { in: ids } },
        select: selectFields,
      });
      const vmap = new Map(videos.map((v) => [v.id, v]));
      items = ids.map((id, i) => {
        const v = vmap.get(id)!;
        const count = grouped[i]?._count.videoId ?? 0;
        return { ...v, supportPoints: count, supportRank: skip + i + 1 };
      });
    }
  } else {
    // --- 人気/新着：DBソート ---
    let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
    if (sort === "new") orderBy = { publishedAt: "desc" };

    const videos = await prisma.video.findMany({
      where: whereBase,
      orderBy,
      skip,
      take,
      select: selectFields,
    });

    // 表示中の動画に対してだけ期間内応援件数を合成（数値表示用）
    const ids = videos.map((v) => v.id);
    let supportMap = new Map<string, number>();
    if (ids.length) {
      const grouped = await prisma.supportEvent.groupBy({
        by: ["videoId"],
        where: { createdAt: { gte: since }, videoId: { in: ids } },
        _count: { videoId: true },
      });
      supportMap = new Map(grouped.map((g) => [g.videoId, g._count.videoId]));
    }
    items = videos.map((v) => ({ ...v, supportPoints: supportMap.get(v.id) ?? 0 }));
  }

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const selectFields = {
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

// ---- helpers ----
function sinceFromRange(range: string | null): Date {
  const now = Date.now();
  const ms =
    range === "1d" ? 24 * 60 * 60 * 1000 :
    range === "7d" ? 7 * 24 * 60 * 60 * 1000 :
                     30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms);
}

function buildShortsWhere(shorts: string | null): Prisma.VideoWhereInput | {} {
  if (shorts === "exclude") return { NOT: { url: { contains: "/shorts/" } } };
  if (shorts === "only")    return { url: { contains: "/shorts/" } };
  return {};
}
