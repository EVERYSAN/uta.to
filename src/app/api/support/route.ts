// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// JST 今日0:00（UTCに直した日時）を返す
function startOfTodayJSTUtc() {
  const now = new Date();
  const jstOffset = 9 * 60; // minutes
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  // その日のJST 0:00 を UTC に換算
  return new Date(utc.getTime() - jstOffset * 60 * 1000);
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0].trim();
  return first || req.headers.get("x-real-ip") || "0.0.0.0";
}
function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const videoId = String(body?.videoId || "");
    if (!videoId) {
      return NextResponse.json(
        { ok: false, error: "invalid_videoId" },
        { status: 400 }
      );
    }

    const amount = 1; // 今は +1 固定
    const ipHash = sha256(getClientIp(req) + (process.env.IP_SALT ?? ""));
    const since = startOfTodayJSTUtc();

    // 同一IPはJST日付で1回だけカウント
    const dup = await prisma.supportEvent.findFirst({
      where: { videoId, ipHash, createdAt: { gte: since } },
      select: { id: true },
    });

    if (dup) {
      const v = await prisma.video.findUnique({
        where: { id: videoId },
        select: { supportPoints: true },
      });
      return NextResponse.json({
        ok: true,
        duplicated: true,
        points: v?.supportPoints ?? 0,
      });
    }

    const [, updated] = await prisma.$transaction([
      prisma.supportEvent.create({ data: { videoId, amount, ipHash } }),
      prisma.video.update({
        where: { id: videoId },
        data: { supportPoints: { increment: amount } },
        select: { supportPoints: true },
      }),
    ]);

    return NextResponse.json({ ok: true, points: updated.supportPoints });
  } catch (e: any) {
    console.error("support POST failed:", e);
    return NextResponse.json(
      { ok: false, error: "internal_error", detail: e?.message },
      { status: 500 }
    );
  }
}
