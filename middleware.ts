// middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export const config = {
  // ingest/refresh系のみ保護（videosは公開のまま）
  matcher: ['/api/ingest/:path*', '/api/refresh/:path*'],
};

export function middleware(req: NextRequest) {
  // Vercel Cron 実行時はこのヘッダーが付与される
  const isCron = req.headers.get('x-vercel-cron') === '1';

  // 手動実行用トークン（?token=... または Authorization: Bearer ...）
  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get('token');
  const auth = req.headers.get('authorization') || '';
  const tokenFromAuth = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  const token = tokenFromQuery || tokenFromAuth;

  // 許可条件
  const ok = isCron || (token && token === process.env.CRON_SECRET);

  if (!ok) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // 必要ならメソッド制限（GET以外405に）
  if (req.method !== 'GET') {
    return new NextResponse('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET' },
    });
  }

  return NextResponse.next();
}
