// FILE: src/app/api/videos/by-ids/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get("ids") || "";
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return NextResponse.json({ ok: true, items: [] });
    }

    const items = await prisma.video.findMany({
      where: { id: { in: ids } },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        title: true,
        url: true,
        thumbnailUrl: true,
        durationSec: true,
        publishedAt: true,
        channelTitle: true,
        views: true,
        likes: true,
      },
    });

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("by-ids error", e);
    return NextResponse.json({ ok: false, items: [] }, { status: 500 });
  }
}
