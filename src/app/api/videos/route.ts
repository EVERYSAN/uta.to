import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const page = parseInt(searchParams.get("p") || "1", 10);
  const sort = searchParams.get("sort") || "new";

  const PAGE_SIZE = 50;
  const skip = (page - 1) * PAGE_SIZE;

  // 🔍 検索条件
  let where = {};
  if (q) {
    where = {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    };
  }

  // 🔽 並び順
  let orderBy: any = { publishedAt: "desc" };
  if (sort === "old") {
    orderBy = { publishedAt: "asc" };
  } else if (sort === "views") {
    orderBy = { views: "desc" };   // 👈 追加
  } else if (sort === "likes") {
    orderBy = { likes: "desc" };   // 👈 追加
  }

  const [items, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy,
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        platform: true,
        platformVideoId: true,
        title: true,
        url: true,
        thumbnailUrl: true,
        durationSec: true,
        publishedAt: true,
        views: true,   // 👈 追加
        likes: true,   // 👈 追加
      },
    }),
    prisma.video.count({ where }),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  });
}
