import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const sort = searchParams.get("sort") || "new"; // new|views|likes
    const take = Math.min(Number(searchParams.get("take") || 40), 100);

    // publishedAt が確実／views,likes は無い環境があるので段階的に決める
    let orderBy: any = { publishedAt: "desc" as const };
    if (sort === "views") orderBy = { views: "desc" as const };
    if (sort === "likes") orderBy = { likes: "desc" as const };

    const where: any = q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { creator: { name: { contains: q, mode: "insensitive" } } },
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
        // ある場合だけ返す（無ければnull）
        views: true as any,
        likes: true as any,
        creator: { select: { name: true } },
      } as any,
    });

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    // エラー内容を見える化（デバッグ用）
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
