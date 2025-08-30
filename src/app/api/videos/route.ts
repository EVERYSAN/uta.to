import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q")?.trim() ?? "";
  const sortParam = (searchParams.get("sort") ?? "new") as "new" | "old" | "views" | "likes";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") ?? "50", 10)));
  const skip = (page - 1) * take;

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

  let orderBy:
    | Prisma.VideoOrderByWithRelationInput
    | Prisma.VideoOrderByWithRelationInput[] = [{ publishedAt: "desc" }];

  switch (sortParam) {
    case "old":
      orderBy = [{ publishedAt: "asc" }];
      break;
    case "views":
      orderBy = [{ views: "desc" }, { publishedAt: "desc" }];
      break;
    case "likes":
      orderBy = [{ likes: "desc" }, { publishedAt: "desc" }];
      break;
    default:
      orderBy = [{ publishedAt: "desc" }];
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

  return NextResponse.json({
    ok: true,
    total,
    page,
    take,
    items,
  });
}
