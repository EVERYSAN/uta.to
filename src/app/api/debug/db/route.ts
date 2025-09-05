// src/app/api/debug/db/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// どのファイルも先頭付近に追加
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";


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
