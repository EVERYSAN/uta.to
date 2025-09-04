// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; // Prisma を使うので Node ランタイムを明示

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

    // 1. 応援イベントを記録（重複排除はまずはクッキーで。サーバ側のIP重複排除はスキーマ次第で後述）
    await prisma.supportEvent.create({
      data: { videoId }, // ← 現行スキーマに合わせて最小構成
    });

    // 2. 直近24hの最新カウントを返す（一覧側も即時反映できるように）
    const count24h = await prisma.supportEvent.count({
      where: { videoId, createdAt: { gte: since24h() } },
    });

    const res = NextResponse.json({ ok: true, support24h: count24h });
    // 二度押し抑制用の軽いクッキー（UX用／サーバ側の厳密制御ではありません）
    res.headers.append("Set-Cookie", `su_${videoId}=1; Max-Age=86400; Path=/; SameSite=Lax`);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("POST /api/support failed", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

/*
  もしスキーマに ipHash（や日付キー）を持っていて1日1回/1IPにしたい場合は、
  上の create の前に以下の重複チェックを入れて data に ipHash を追加してください。
  （スキーマが一致しないと TypeScript が落ちるので、カラムが存在するときだけ使ってください）

  // --- ここから（ipHash 対応例） ---
  async function sha256Hex(s: string) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const xfwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = xfwd.split(",")[0]?.trim() || "0.0.0.0";
  const ipHash = await sha256Hex(ip);
  const today = new Date(); today.setUTCHours(0,0,0,0);

  const dup = await prisma.supportEvent.findFirst({
    where: { videoId, ipHash, createdAt: { gte: today } },
    select: { id: true },
  });
  if (dup) return NextResponse.json({ ok:false, error:"duplicate" }, { status: 409 });

  await prisma.supportEvent.create({ data: { videoId, ipHash } });
  // --- ここまで ---
*/
