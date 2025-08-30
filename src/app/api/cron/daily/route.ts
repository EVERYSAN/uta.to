// src/app/api/cron/daily/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Vercelのスケジュール実行には x-vercel-cron: "1" が付く
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  // 手動実行（保護したい場合）は CRON_SECRET ヘッダで許可
  const secret = process.env.CRON_SECRET || "";
  const fromManual = req.headers.get("x-cron-secret");
  if (!isVercelCron && secret && fromManual !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const origin = new URL(req.url).origin;

  // 直近1日分を取り込み対象に（クォータ節約しつつ取りこぼし防止）
  const publishedAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const steps: any[] = [];

  // 1) 新規取り込み（キーワードやページ数は用途に合わせて調整）
  const ingestUrl = `${origin}/api/ingest/youtube?q=${encodeURIComponent(
    "歌ってみた"
  )}&maxPages=60&publishedAfter=${encodeURIComponent(publishedAfter)}`;
  const r1 = await fetch(ingestUrl);
  const j1 = await r1.json().catch(() => ({}));
  steps.push({ step: "ingest", status: r1.status, body: j1 });

  // 2) 統計更新（直近48時間の動画を上限1000件）
  const refreshUrl = `${origin}/api/refresh/youtube?sinceHours=48&take=1000`;
  const r2 = await fetch(refreshUrl);
  const j2 = await r2.json().catch(() => ({}));
  steps.push({ step: "refresh", status: r2.status, body: j2 });

  return NextResponse.json({ ok: true, steps });
}
