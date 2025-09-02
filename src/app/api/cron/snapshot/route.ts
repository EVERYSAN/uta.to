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
  if (!authorized(req)) {
    return new Response(JSON.stringify({ ok: false, route: "cron/snapshot", error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const t0 = Date.now();
  const url = new URL(req.url);
  const hours = Math.min(72, Math.max(6, Number(url.searchParams.get("sinceHours") || "48") || 48));
  const limit = Math.min(500, Math.max(50, Number(url.searchParams.get("limit") || "300") || 300));
  const query = url.searchParams.get("q") || undefined;

  // 直近公開動画を取得
  const { items } = await fetchRecentYouTubeSinceHours(hours, { limit, query });

  let fetched = items.length;
  let upserts = 0;
  let skippedNoPublishedAt = 0;
  const errs: string[] = [];

  for (const r of items) {
    try {
      if (!r.publishedAt) {
        skippedNoPublishedAt++;
        continue; // publishedAt は必須
      }
      const publishedAt = new Date(r.publishedAt);

      const platform = "youtube";
      const platformVideoId = r.id;

      const title = r.title ?? "(untitled)";
      const urlStr = r.url ?? `https://www.youtube.com/watch?v=${platformVideoId}`;
      const thumb = r.thumbnailUrl ?? "";
      const channel = r.channelTitle ?? "";

      const duration = r.durationSec ?? undefined;
      const views = r.views ?? undefined;
      const likes = r.likes ?? undefined;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        update: {
          title,
          url: urlStr,
          thumbnailUrl: thumb,
          channelTitle: channel,
          ...(duration !== undefined ? { durationSec: duration } : {}),
          publishedAt,
          ...(views !== undefined ? { views } : {}),
          ...(likes !== undefined ? { likes } : {}),
        },
        create: {
          platform,
          platformVideoId,
          title,
          url: urlStr,
          thumbnailUrl: thumb,
          channelTitle: channel,
          durationSec: duration,
          publishedAt,
          views,
          likes,
        },
        select: { id: true },
      });

      upserts++;
    } catch (e: any) {
      errs.push(String(e?.message || e));
    }
  }

  const latest = await prisma.video.findFirst({
    orderBy: [{ publishedAt: "desc" }],
    select: { platform: true, publishedAt: true, createdAt: true },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      route: "cron/snapshot",
      params: { hours, limit, query },
      fetched,
      upserts,
      skippedNoPublishedAt,
      latest,
      tookMs: Date.now() - t0,
      errors: errs.length ? errs.slice(0, 5) : undefined,
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}
