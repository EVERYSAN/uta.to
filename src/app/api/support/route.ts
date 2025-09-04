// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; // Prisma なので Node を明示

function since24h() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoId = typeof body?.videoId === "string" ? body.videoId : "";
    if (!videoId) {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }

    // 応援イベントを記録（スキーマに合わせて最小構成）
    await prisma.supportEvent.create({ data: { videoId } });

    // 24h 件数を返す（UI を即時更新できるように）
    const support24h = await prisma.supportEvent.count({
      where: { videoId, createdAt: { gte: since24h() } },
    });

    const res = NextResponse.json({ ok: true, support24h });
    res.headers.append("Set-Cookie", `su_${videoId}=1; Max-Age=86400; Path=/; SameSite=Lax`);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("POST /api/support failed:", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

// 任意：動作確認用
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get("videoId") || "";
  if (!videoId) return NextResponse.json({ ok: true });
  const support24h = await prisma.supportEvent.count({
    where: { videoId, createdAt: { gte: since24h() } },
  });
  return NextResponse.json({ ok: true, support24h });
}
