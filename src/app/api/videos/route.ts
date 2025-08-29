import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  const sort = searchParams.get("sort") || "new"; // new|views|likes
  const take = Math.min(Number(searchParams.get("take") || 40), 100);

  const orderBy =
    sort === "views" ? { views: "desc" as const }
    : sort === "likes" ? { likes: "desc" as const }
    : { publishedAt: "desc" as const };

  const where = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
          { creator: { name: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const videos = await prisma.video.findMany({
    where,
    orderBy,
    take,
    include: { creator: true },
  });

  return NextResponse.json({ ok: true, items: videos });
}

