// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const q = (searchParams.get("q") ?? "").trim();
  type SortKey = "new" | "old" | "views" | "likes";
  const sort = (searchParams.get("sort") as SortKey) ?? "new";

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") ?? "50", 10)));

  const where =
    q.length > 0
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { channelTitle: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : undefined;

  const orderBy =
    sort === "old"
      ? [{ publishedAt: "asc" as const }]
      : sort === "views"
      ? // views 同値のときは新しい順に
        [{ views: "desc" as const }, { publishedAt: "desc" as const }]
      : sort === "likes"
      ? [{ likes: "desc" as const }, { publishedAt: "desc" as const }]
      : [{ publishedAt: "desc" as const }]; // new

  const [items, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy,
      take,
      skip: (page - 1) * take,
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

  return NextResponse.json({
    ok: true,
    total,
    page,
    take,
    items,
  });
}
