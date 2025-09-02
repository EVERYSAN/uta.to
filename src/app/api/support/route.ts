// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();
const SALT = process.env.SUPPORT_SALT || "support-salt";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoId = String(body.videoId || "");
    const amountNum = Number(body.amount ?? 1);

    if (!videoId) {
      return NextResponse.json({ ok: false, error: "videoId required" }, { status: 400 });
    }
    const amount = Math.min(10, Math.max(1, isFinite(amountNum) ? amountNum : 1));

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ua = req.headers.get("user-agent") || "";
    const ipHash = ip ? crypto.createHmac("sha256", SALT).update(ip).digest("hex").slice(0, 32) : null;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (ipHash) {
      const recent = await prisma.supportEvent.count({
        where: { videoId, ipHash, createdAt: { gte: since } },
      });
      if (recent >= 3) {
        return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
      }
    }

    const [, agg] = await prisma.$transaction([
      prisma.supportEvent.create({ data: { videoId, amount, ua, ipHash } }),
      prisma.video.update({
        where: { id: videoId },
        data: { supportPoints: { increment: amount } },
        select: { supportPoints: true },
      }),
    ]);

    return NextResponse.json({ ok: true, points: agg.supportPoints });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
