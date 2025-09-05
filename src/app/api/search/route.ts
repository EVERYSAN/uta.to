// src/app/api/search/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // SSGさせない
export const revalidate = 0;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const q = (sp.get("q") ?? "").trim();
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip = (page - 1) * take;

  const range = (sp.get("range") ?? "1d").toLowerCase(); // 1d|7d|30d
  const sort  = (sp.get("sort")  ?? "hot").toLowerCase(); // hot|new|support
  const shorts = (sp.get("shorts") ?? "all").toLowerCase(); // all|exclude|only

  const since = sinceFromRange(range);

  // 検索条件
  const keywordWhere: Prisma.VideoWhereInput =
    q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { channelTitle: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};

  const baseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
    ...keywordWhere,
  };

  // DB並び。応援はあとで手動ソート
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
  if (sort === "new") orderBy = { publishedAt: "desc" };

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
      channelTitle: true,
      url: true,
      thumbnailUrl: true,
      durationSec: true,
      publishedAt: true,
      views: true,
      likes: true,
    },
  });

  // 応援件数（期間内）を付与（sort=support のときだけ集計）
  let items = videos.map(v => ({ ...v, supportPoints: 0 }));
  if (videos.length > 0 && sort === "support") {
    const ids = videos.map(v => v.id);
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { videoId: { in: ids }, createdAt: { gte: since } },
      _count: { videoId: true },
    });
    const supportMap = new Map(grouped.map(g => [g.videoId, g._count.videoId]));
    items = items.map(v => ({ ...v, supportPoints: supportMap.get(v.id) ?? 0 }))
                 .sort((a, b) => (b.supportPoints ?? 0) - (a.supportPoints ?? 0));
  }

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// ---- helpers ----
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
