import { NextRequest, NextResponse } from "next/server";

function isAuthorized(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("secret");
  const h = req.headers.get("x-cron-secret");
  if (q && process.env.CRON_SECRET && q === process.env.CRON_SECRET) return true;
  if (h && process.env.CRON_SECRET && h === process.env.CRON_SECRET) return true;
  // Vercel Cron の Run/実行は x-vercel-cron: 1 が付く
  if (req.headers.get("x-vercel-cron") === "1") return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const origin = req.nextUrl.origin;            // 今のデプロイのドメイン
  const secret = process.env.CRON_SECRET ?? ""; // 下流にも同じsecretを付けて認証を通す
  const headers = { "x-cron-secret": secret };

  const urls = [
    `${origin}/api/ingest/youtube?days=1&limit=200`, // 新着取り込み
    `${origin}/api/refresh/youtube?onlyMissing=1&take=800`, // views/likes 未取得の穴埋め
    `${origin}/api/trending/snapshot?window=1d`, // 24hスナップショット作成
  ];

  const [ingest, refresh, snapshot] = await Promise.all(
    urls.map(async (u) => {
      const res = await fetch(u, { headers, cache: "no-store" });
      let data: any = {};
      try { data = await res.json(); } catch {}
      return { status: res.status, data };
    })
  );

  return NextResponse.json({ ok: true, ingest, refresh, snapshot });
}
