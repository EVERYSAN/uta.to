import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q")?.trim() ?? "";
    type SortKey = "new" | "old" | "views" | "likes";
    const sort = (searchParams.get("sort") as SortKey) ?? "new";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") ?? "50", 10)));

    // where
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

    // orderBy



    
    const orderBy =
      sort === "old"
        ? [{ publishedAt: "asc" as const }]
        : sort === "views"
        ? [{ views: "desc" as const }, { publishedAt: "desc" as const }]
        : sort === "likes"
        ? [{ likes: "desc" as const }, { publishedAt: "desc" as const }]
        : [{ publishedAt: "desc" as const }];

    
    const [total, items] = await Promise.all([
      prisma.video.count({ where }),
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
    ]);

    return NextResponse.json({ ok: true, total, page, take, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
