// src/app/api/cron/snapshot/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // EdgeでなければnodejsでOK

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const BYPASS = process.env.VERCEL_BYPASS_TOKEN; // ← ダッシュボードで作ったトークンを環境変数に

export async function GET() {
  try {
    const url = new URL("/api/refresh/youtube", BASE_URL);
    if (BYPASS) {
      // どちらか一方でもOK。念のため両方付与
      url.searchParams.set("x-vercel-protection-bypass", BYPASS);
      url.searchParams.set("x-vercel-set-bypass-cookie", "true");
    }

    const res = await fetch(url.toString(), {
      headers: BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {},
      cache: "no-store",
      next: { revalidate: 0 },
    });

    const body = await res.text();
    if (!res.ok) {
      console.error("snapshot refresh/youtube failed", res.status, body.slice(0, 400));
      return NextResponse.json({ ok: false, status: res.status }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[snapshot] error", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
