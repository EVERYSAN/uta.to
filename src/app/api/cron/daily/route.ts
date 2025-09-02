// app/api/cron/daily/route.ts
export const dynamic = 'force-dynamic'; // ルートのキャッシュ無効化

function okFromVercelCron(req: Request) {
  const ua = req.headers.get('user-agent') || '';
  const hv = req.headers.get('x-vercel-cron');
  // Vercel Cron の手動 Run/定期実行で付くヘッダやUAを許可
  return hv !== null || /Vercel-Cron/i.test(ua);
}

function okFromSecret(req: Request) {
  const url = new URL(req.url);
  const bearer =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const q = url.searchParams.get('secret') || url.searchParams.get('token');
  const need = process.env.CRON_SECRET;
  if (!need) return false;
  return bearer === need || q === need;
}

export async function GET(req: Request) {
  if (!(okFromVercelCron(req) || okFromSecret(req))) {
    return new Response('Unauthorized', { status: 401 });
  }

  // ---- ここに毎日の集計処理 ----
  // 例:
  // await doDailyAggregation();
  // await refreshTrendingViews();
  // await purgeCaches();

  return new Response('ok', { status: 200 });
}
