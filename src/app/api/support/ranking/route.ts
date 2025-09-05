// src/app/api/support/ranking/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// どのファイルも先頭付近に追加
export const dynamic = "force-dynamic";
export const revalidate = 0;


export const runtime = "nodejs"; // Prisma は Node で

type Range = "24h" | "7d" | "30d";

function since(range: Range) {
  const now = Date.now();
  if (range === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (range === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return new Date(now - 24 * 60 * 60 * 1000);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const range = (url.searchParams.get("range") as Range) || "24h";
    const take = Math.min(Math.max(Number(url.searchParams.get("take") || 20), 1), 100);

    const g = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { createdAt: { gte: since(range) } },
      _count: { videoId: true },
      orderBy: { _count: { videoId: "desc" } },
      take,
    });

    if (g.length === 0) {
      const res = NextResponse.json({ ok: true, items: [] as any[] });
      res.headers.set("Cache-Control", "no-store");
      return res;
    }

    const ids = g.map((r) => r.videoId);
    const videos = await prisma.video.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        channelTitle: true,
        url: true,
        thumbnailUrl: true,
        durationSec: true,
        publishedAt: true,
        views: true,
        likes: true,
      },
    });
    const vmap = new Map(videos.map((v) => [v.id, v]));

    const items = g
      .map((r) => {
        const v = vmap.get(r.videoId);
        if (!v) return null;
        return {
          videoId: r.videoId,
          support: r._count.videoId,
          video: v,
        };
      })
      .filter(Boolean);

    const res = NextResponse.json({ ok: true, items });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("GET /api/support/ranking failed:", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
