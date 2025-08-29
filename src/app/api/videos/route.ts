import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos?q=...&sort=new|views|likes&take=40
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const sort = searchParams.get("sort") || "new";
    const take = Math.min(Number(searchParams.get("take") || 40), 100);

    let orderBy: any = { publishedAt: "desc" as const };
    if (sort === "views") orderBy = { views: "desc" as const };
    if (sort === "likes") orderBy = { likes: "desc" as const };

    const where: any = q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { channelTitle: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};

    const items = await prisma.video.findMany({
      where,
      orderBy,
      take,
      select: {
        id: true,
        title: true,
        url: true,
        platform: true,
        platformVideoId: true,
        thumbnailUrl: true,
        publishedAt: true,
        views: true as any,
        likes: true as any,
        channelTitle: true as any,
      } as any,
    });

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
