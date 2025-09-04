// src/app/api/cron/daily/route.ts
export const dynamic = "force-dynamic";

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function authorized(req: Request) {
  const u = new URL(req.url);
  const s = process.env.CRON_SECRET ?? "";
  const ua = req.headers.get("user-agent") || "";
  return (
    req.headers.get("x-vercel-cron") !== null ||
    /vercel-cron/i.test(ua) ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === s ||
    u.searchParams.get("secret") === s
  );
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const t0 = Date.now();
  const since = new Date(Date.now() - 24 * 3600_000);

  // 健全性チェック：公開/入荷の24h件数
  const nPub = await prisma.video.count({
    where: { platform: "youtube" as any, publishedAt: { gte: since } },
  });

  let nIng = 0;
  try {
    nIng = await prisma.video.count({
      where: { platform: "youtube" as any, ...( { createdAt: { gte: since } } as any) },
    });
  } catch { /* createdAt 未導入なら 0 のまま */ }

  // 必要ならここで集計テーブル更新 etc...
  // await prisma.trending.deleteMany({ where: { window: '24h' } });
  // ...

  return Response.json({
    ok: true,
    counts24h: { published: nPub, ingested: nIng },
    windowSince: since.toISOString(),
    tookMs: Date.now() - t0,
  }, { headers: { "Cache-Control": "no-store" } });
}
