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

  const url = new URL(req.url);
  const hours = Math.min(72, Math.max(6, Number(url.searchParams.get("sinceHours") || "48") || 48));
  const limit = Math.min(500, Math.max(50, Number(url.searchParams.get("limit") || "300") || 300));
  const query = url.searchParams.get("q") || undefined;

  // 直近公開（publishedAfter + order=date）
  const { items } = await fetchRecentYouTubeSinceHours(hours, { limit, query });

  let upserts = 0;
  const errors: string[] = [];

  for (const r of items) {
    try {
      const platform = "youtube";
      const platformVideoId = r.id;

      // publishedAt は schema で必須想定：無い行はスキップ
      if (!r.publishedAt) continue;
      const publishedAt = new Date(r.publishedAt);

      // 文字列系は update=undefined（省略）、createは空文字フォールバックで“必須”にも耐性
      const title = r.title ?? "(untitled)";
      const urlStr = r.url ?? `https://www.youtube.com/watch?v=${platformVideoId}`;
      const thumb = r.thumbnailUrl ?? undefined;        // update では省略可能
      const channel = r.channelTitle ?? "";             // create で必須でもOK

      // 数値系は undefined を使う（null は渡さない）
      const duration = r.durationSec ?? undefined;
      const views = r.views ?? undefined;
      const likes = r.likes ?? undefined;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        update: {
          title,                                    // string
          url: urlStr,                              // string
          ...(thumb !== undefined ? { thumbnailUrl: thumb } : {}), // string | undefined
          ...(duration !== undefined ? { durationSec: duration } : {}), // number | undefined
          publishedAt,                              // Date（必須）
          channelTitle: channel,                    // string
          ...(views !== undefined ? { views } : {}),
          ...(likes !== undefined ? { likes } : {}),
        },
        create: {
          platform,
          platformVideoId,
          title,                                    // string（空文字fallback済み）
          url: urlStr,                              // string
          thumbnailUrl: thumb ?? "",                // string に寄せる
          durationSec: duration,                    // number | undefined
          publishedAt,                              // Date（必須）
          channelTitle: channel,                    // string（空文字fallback済み）
          views,
          likes,
          // createdAt は schema の @default(now()) に任せる
        },
        select: { id: true },
      });

      upserts++;
    } catch (e: any) {
      errors.push(String(e?.message || e));
    }
  }

  const latest = await prisma.video.findFirst({
    orderBy: [{ publishedAt: "desc" }],
    select: { publishedAt: true, createdAt: true, platform: true },
  });

  return Response.json(
    {
      ok: true,
      params: { hours, limit, query },
      fetched: items.length,
      upserts,
      latest,
      tookMs: Date.now() - t0,
      errors: errors.length ? errors.slice(0, 3) : undefined,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
