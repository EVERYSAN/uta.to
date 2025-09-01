
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server"; // 使っている場合のみ

function startOfUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
};

function isAuthorized(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("secret");
  const h = req.headers.get("x-cron-secret");
  if (q && q === process.env.CRON_SECRET) return true;
  if (h && h === process.env.CRON_SECRET) return true;
  if (req.headers.get("x-vercel-cron") === "1") return true;
  return false;
};
/**
 * 使い方:
 * /api/cron/snapshot            -> 当日(UTC) 00:00 で upsert
 * /api/cron/snapshot?date=2025-06-01
 * /api/cron/snapshot?take=500&cursor=<id>
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const take = Math.min(1000, Math.max(1, parseInt(searchParams.get("take") ?? "500", 10)));
  const cursor = searchParams.get("cursor") ?? undefined;

  const dateStr = searchParams.get("date"); // YYYY-MM-DD（UTC）
  const targetDate = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : startOfUTC(new Date());

  const videos = await prisma.video.findMany({
    select: { id: true, views: true, likes: true },
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: "asc" },
  });

  for (const v of videos) {
    await prisma.videoMetric.upsert({
      where: { videoId_date: { videoId: v.id, date: targetDate } },
      create: { videoId: v.id, date: targetDate, views: v.views ?? 0, likes: v.likes ?? 0 },
      update: { views: v.views ?? 0, likes: v.likes ?? 0 },
    });
  }

  return NextResponse.json({
    ok: true,
    date: targetDate.toISOString().slice(0, 10),
    count: videos.length,
    nextCursor: videos.length === take ? videos[videos.length - 1].id : null,
  });
}
