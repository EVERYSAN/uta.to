// src/app/api/debug/db/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [total, withViews, top] = await Promise.all([
      prisma.video.count(),
      prisma.video.count({ where: { views: { gt: 0 } } }),
      prisma.video.findFirst({
        where: { views: { gt: 0 } },
        orderBy: { views: "desc" },
        select: {
          id: true,
          title: true,
          views: true,
          url: true,
          platform: true,
          platformVideoId: true,
        },
      }),
    ]);

    return NextResponse.json({ ok: true, total, withViews, top });
  } catch (e) {
    console.error("debug/db error", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
