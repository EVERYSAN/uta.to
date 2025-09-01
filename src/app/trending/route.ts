// src/app/api/trending/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type WindowKey = "24h" | "48h" | "7d" | "30d";
type SortKey = "views" | "likes";

function windowToMs(win: WindowKey) {
  switch (win) {
    case "24h": return 24 * 60 * 60 * 1000;
    case "48h": return 48 * 60 * 60 * 1000;
    case "7d":  return 7  * 24 * 60 * 60 * 1000;
    case "30d": return 30 * 24 * 60 * 60 * 1000;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const windowParam = (searchParams.get("window") as WindowKey) || "24h";
  const sortBy = (searchParams.get("sortBy") as SortKey) || "views";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") ?? "50", 10)));

  async function fetchWindow(win: WindowKey) {
    const cutoff = new Date(Date.now() - windowToMs(win));
    const [total, items] = await Promise.all([
      prisma.video.count({
        where: {
          platform: "youtube",
          publishedAt: { gte: cutoff },
        },
      }),
      prisma.video.findMany({
        where: {
          platform: "youtube",
          publishedAt: { gte: cutoff },
        },
        orderBy: [
          { [sortBy]: "desc" as const },
          { publishedAt: "desc" as const },
        ],
        skip: (page - 1) * take,
        take,
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
    return { win, total, items };
  }

  let result = await fetchWindow(windowParam);
  // 0件なら48hに自動フォールバック
  if (result.total === 0 && windowParam === "24h") {
    result = await fetchWindow("48h");
  }

  return NextResponse.json({
    ok: true,
    window: result.win,
    sortBy,
    page,
    take,
    total: result.total,
    items: result.items,
  });
}
