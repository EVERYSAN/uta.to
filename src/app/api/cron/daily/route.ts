// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(res: any, init: number = 200) {
  return NextResponse.json({ ok: true, ...res }, { status: init });
}
function fail(msg: string, code = 401) {
  return NextResponse.json({ ok: false, error: msg }, { status: code });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const headerSecret = req.headers.get("x-cron-secret") ?? "";
  const querySecret  = url.searchParams.get("secret") ?? "";
  const secret = headerSecret || querySecret;
  if (!isVercelCron && secret !== (process.env.CRON_SECRET ?? "")) {
    return fail("unauthorized");
  }

  const base =
    process.env.PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const h = { "x-cron-secret": process.env.CRON_SECRET ?? "" };

  const fetchJson = async (path: string) => {
    const r = await fetch(`${base}${path}`, { headers: h, cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  };

  // 1) 新着の取り込み
  const ingest = await fetchJson(`/api/ingest/youtube`);
  // 2) 直近の動画の再生数/高評価を更新
  const refresh = await fetchJson(`/api/refresh/youtube?recentHours=24&take=500`);
  // 3) 24h トレンドのスナップショット作成
  const snap = await fetchJson(`/api/cron/snapshot`);

  return ok({ ingest, refresh, snapshot: snap });
}
