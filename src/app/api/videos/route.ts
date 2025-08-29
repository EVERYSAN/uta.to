import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// 1ページの件数は 50 で固定
const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const sort = (searchParams.get("sort") || "newest").toLowerCase(); // newest | oldest
  const cursor = searchParams.get("cursor"); // 次ページの開始位置（video.id）
  // もしユーザーが limit を指定しても 50 に丸める
  const limit = PAGE_SIZE;

  const where: Prisma.VideoWhereInput | undefined = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      }
    : undefined;

  const orderBy: Prisma.VideoOrderByWithRelationInput =
    sort === "oldest" ? { publishedAt: "asc" } : { publishedAt: "desc" };

  // 1件だけ余分に取って「次があるか」を判定する
  const items = await prisma.video.findMany({
    where,
    orderBy,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      platform: true,
      platformVideoId: true,
      publishedAt: true,
      durationSec: true,
    },
  });

  const hasMore = items.length > limit;
  const pageItems = items.slice(0, limit);
  const nextCursor = hasMore ? items[limit].id : null;

  return NextResponse.json({
    items: pageItems,
    nextCursor,
    hasMore,
  });
}
