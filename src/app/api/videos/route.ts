// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type SortKey = "trending" | "new" | "old" | "views" | "likes";
type ShortsMode = "any" | "only" | "exclude";

function hoursFromRange(r?: string): number {
  const v = (r ?? "1d").toLowerCase();
  if (v === "24h" || v === "1d") return 24;
  if (v === "7d") return 24 * 7;
  if (v === "30d") return 24 * 30;
  return 24;
}

function parseShortsMode(sp: URLSearchParams): ShortsMode {
  const v = (sp.get("shorts") ?? "any").toLowerCase();
  if (v === "only" || v === "exclude") return v;
  return "any";
}

function shortsWhere(mode: ShortsMode): Prisma.VideoWhereInput | undefined {
  // #shorts 判定は title/description のハッシュタグ と URL の /shorts/ を基準に
  const isShorts = [
    { title:       { contains: "#shorts", mode: "insensitive" as const } },
    { description: { contains: "#shorts", mode: "insensitive" as const } },
    { url:         { contains: "/shorts/", mode: "insensitive" as const } },
  ];

  if (mode === "only")    return { OR: isShorts };
  if (mode === "exclude") return { NOT: isShorts };
  return undefined; // any
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const q     = sp.get("q")?.trim() ?? "";
  const sort  = (sp.get("sort") as SortKey) || "trending";
  const range = sp.get("range") || "1d";
  const shorts = parseShortsMode(sp);

  // ページング
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(sp.get("take") ?? "50", 10)));
  const skip = (page - 1) * take;

  // where を組み立て
  const where: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(q
      ? {
          OR: [
            { title:        { contains: q, mode: "insensitive" } },
            { description:  { contains: q, mode: "insensitive" } },
            { channelTitle: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(shortsWhere(shorts) ?? {}),
  };

  // 並び順
  let orderBy: Prisma.VideoOrderByWithRelationInput[] = [];
  if (sort === "trending") {
    const hours = hoursFromRange(range);
    const since = new Date(Date.now() - hours * 3600 * 1000);
    where.publishedAt = { ...(where.publishedAt as any), gte: since };
    orderBy = [{ views: "desc" }, { likes: "desc" }, { publishedAt: "desc" }];
  } else if (sort === "new") {
    orderBy = [{ publishedAt: "desc" }];
  } else if (sort === "old") {
    orderBy = [{ publishedAt: "asc" }];
  } else if (sort === "views") {
    orderBy = [{ views: "desc" }, { publishedAt: "desc" }];
  } else if (sort === "likes") {
    orderBy = [{ likes: "desc" }, { publishedAt: "desc" }];
  }

  const [items, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy,
      take,
      skip,
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
      },
    }),
    prisma.video.count({ where }),
  ]);

  return NextResponse.json({ ok: true, total, page, take, items });
}
