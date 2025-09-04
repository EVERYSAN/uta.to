// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

function getClientIp(req: Request) {
  const h = new Headers(req.headers);
  const fwd = h.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "0.0.0.0";
  const ua = h.get("user-agent") || "";
  const salt = process.env.SUPPORT_SALT || "salt";
  return crypto.createHash("sha256").update(`${ip}|${ua}|${salt}`).digest("hex");
}

function since24h() {
  const d = new Date();
  d.setHours(d.getHours() - 24, d.getMinutes(), 0, 0);
  return d;
}

export async function POST(req: Request) {
  try {
    const { videoId } = await req.json();
    if (!videoId) {
      return NextResponse.json({ ok: false, error: "missing_videoId" }, { status: 400 });
    }

    const ipHash = getClientIp(req);

    // 1日1回まで（JSTに寄せてもOK。ここは24hを見るなら since24h() でも良い）
    const dup = await prisma.supportEvent.findFirst({
      where: { videoId, ipHash, createdAt: { gte: since24h() } },
      select: { id: true },
    });
    if (dup) {
      // 直近24hの合計を返す（UIはこれで最新表示にできる）
      const agg = await prisma.supportEvent.aggregate({
        _sum: { amount: true },
        where: { videoId, createdAt: { gte: since24h() } },
      });
      const support24h = agg._sum.amount ?? 0;
      return NextResponse.json({ ok: false, reason: "duplicate", support24h });
    }

    await prisma.supportEvent.create({
      data: { videoId, ipHash, amount: 1 },
    });

    const agg = await prisma.supportEvent.aggregate({
      _sum: { amount: true },
      where: { videoId, createdAt: { gte: since24h() } },
    });
    const support24h = agg._sum.amount ?? 0;

    return NextResponse.json({ ok: true, support24h });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
