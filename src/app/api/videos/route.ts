import { NextRequest, NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SortKey = "new" | "old" | "views" | "likes";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q")?.trim() ?? "";
  const sort = (searchParams.get("sort") as SortKey) ?? "new";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") ?? "50", 10)));

  const where: Prisma.VideoWhereInput | undefined =
    q.length > 0
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { channelTitle: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : undefined;

  const orderBy: Prisma.VideoOrderByWithRelationInput | Prisma.VideoOrderByWithRelationInput[] =
    sort === "old"
      ? { publishedAt: "asc" }
      : sort === "views"
      ? [{ views: "desc" }, { publishedAt: "desc" }]
      : sort === "likes"
      ? [{ likes: "desc" }, { publishedAt: "desc" }]
      : { publishedAt: "desc" };

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
