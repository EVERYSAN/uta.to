// src/app/api/cron/snapshot/route.ts
export const dynamic = "force-dynamic";

import { PrismaClient } from "@prisma/client";
import { fetchRecentYouTubeSinceHours } from "@/lib/youtube";

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

  // パラメータ（手動Run時に上書きできるように）
  const url = new URL(req.url);
  const hours = Math.min(72, Math.max(6, Number(url.searchParams.get("sinceHours") || "48") || 48));
  const limit = Math.min(500, Math.max(50, Number(url.searchParams.get("limit") || "300") || 300));
  const query = url.searchParams.get("q") || undefined; // 例: "歌ってみた"

  // 直近公開の取得
  const { items } = await fetchRecentYouTubeSinceHours(hours, { limit, query });

  let upserts = 0, errors: string[] = [];
  const now = new Date();

  for (const r of items) {
    try {
      const platform = "youtube"; // 小文字に正規化
      const platformVideoId = r.id;
      const publishedAt = r.publishedAt ? new Date(r.publishedAt) : null;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        update: {
          title: r.title ?? null,
          url: r.url ?? `https://www.youtube.com/watch?v=${platformVideoId}`,
          thumbnailUrl: r.thumbnailUrl ?? null,
          durationSec: r.durationSec ?? null,
          publishedAt,
          channelTitle: r.channelTitle ?? null,
          views: r.views ?? null,
          likes: r.likes ?? null,
        },
        create: {
          platform,
          platformVideoId,
          title: r.title ?? null,
          url: r.url ?? `https://www.youtube.com/watch?v=${platformVideoId}`,
          thumbnailUrl: r.thumbnailUrl ?? null,
          durationSec: r.durationSec ?? null,
          publishedAt,
          channelTitle: r.channelTitle ?? null,
          views: r.views ?? null,
          likes: r.likes ?? null,
          createdAt: now, // 入荷時刻
        },
        select: { id: true },
      });

      upserts++;
    } catch (e: any) {
      errors.push(String(e));
    }
  }

  // 診断JSON
  const latest = await prisma.video.findFirst({
    orderBy: [{ publishedAt: "desc" }],
    select: { publishedAt: true, createdAt: true, platform: true },
  });

  return Response.json({
    ok: true,
    params: { hours, limit, query },
    fetched: items.length,
    upserts,
    latest,
    tookMs: Date.now() - t0,
    errors: errors.length ? errors.slice(0, 3) : undefined,
  }, { headers: { "Cache-Control": "no-store" } });
}
