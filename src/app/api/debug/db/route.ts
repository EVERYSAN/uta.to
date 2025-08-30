// src/app/api/debug/db/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [total, withViews, top] = await Promise.all([
    prisma.video.count(),
    prisma.video.count({ where: { views: { gt: 0 } } }),
    prisma.video.findFirst({
      where: { views: { gt: 0 } },
      orderBy: { views: "desc" },
      select: { id: true, platform: true, platformVideoId: true, title: true, views: true, likes: true },
    }),
  ]);
  return NextResponse.json({ total, withViews, top });
}
