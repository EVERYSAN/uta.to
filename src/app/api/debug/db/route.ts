// src/app/api/debug/db/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 集計：全動画数、views>0 の数、viewsのトップ1
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
          likes: true,
          supportPoints: true,
          platform: true,
          platformVideoId: true,
          publishedAt: true,
        },
      }),
    ]);

    // 直近24hの応援イベント数
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentSupport = await prisma.supportEvent.count({
      where: { createdAt: { gte: since24h } },
    });

    return NextResponse.json({
      ok: true,
      total,
      withViews,
      top,
      recentSupport,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
