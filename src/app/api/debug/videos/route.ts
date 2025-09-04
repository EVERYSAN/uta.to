// src/app/api/debug/videos/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const prisma = new PrismaClient();

function from(hours: number) {
  return new Date(Date.now() - hours * 3600_000);
}

export async function GET() {
  try {
    const from24h = from(24);
    const from7d = from(24 * 7);
    const from30d = from(24 * 30);

    const [total, nullPub, c24h, c7d, c30d] = await Promise.all([
      prisma.video.count(),
      prisma.video.count({ where: { publishedAt: null } }),
      prisma.video.count({ where: { publishedAt: { gte: from24h } } }),
      prisma.video.count({ where: { publishedAt: { gte: from7d } } }),
      prisma.video.count({ where: { publishedAt: { gte: from30d } } }),
    ]);

    const latest = await prisma.video.findMany({
      select: { id: true, title: true, publishedAt: true, url: true, durationSec: true },
      orderBy: { publishedAt: "desc" },
      take: 10,
    });

    const oldest = await prisma.video.findFirst({
      select: { id: true, title: true, publishedAt: true },
      orderBy: { publishedAt: "asc" },
    });

    return NextResponse.json({
      ok: true,
      now: new Date().toISOString(),
      counts: {
        total,
        publishedAt_null: nullPub,
        last24h: c24h,
        last7d: c7d,
        last30d: c30d,
      },
      window: {
        from24h: from24h.toISOString(),
        from7d: from7d.toISOString(),
        from30d: from30d.toISOString(),
      },
      latest10: latest,
      oldest,
      hint: "last24h が 0 で last7d/30d が >0 なら、24時間以内の取り込みが無い＝取り込みジョブの問題。",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
