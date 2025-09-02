// src/app/api/cron/snapshot/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { defined } from "@/lib/defined";
import { logError, logInfo } from "@/lib/logger";

export const runtime = "nodejs"; // Prisma/Fetch 用

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? 24);
  const limit = Number(url.searchParams.get("limit") ?? 300);
  const query = url.searchParams.get("query") ?? "";

  if (!process.env.YT_API_KEY) {
    logError("YT_API_KEY missing");
    return NextResponse.json({ ok: false, route: "cron/snapshot", error: "YT_API_KEY not set" }, { status: 500 });
  }

  try {
    // ここはあなたの既存の取得ロジックに置き換えてOK：
    // results: Array<{
    //   platform: 'youtube'; platformVideoId: string;
    //   url?: string | null; title?: string | null; thumbnailUrl?: string | null;
    //   durationSec?: number | null; publishedAt?: string | Date | null;
    //   channelTitle?: string | null; views?: number | null; likes?: number | null;
    // }>
    const results = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/refresh/youtube?hours=${hours}&limit=${limit}&q=${encodeURIComponent(query)}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`refresh/youtube ${r.status}`)))
      .then(j => Array.isArray(j.items) ? j.items : []);

    let upserts = 0;
    let skippedNoPublishedAt = 0;

    for (const r of results) {
      const platform = (r.platform ?? "youtube").toLowerCase();
      const platformVideoId = r.platformVideoId ?? "";

      if (!platformVideoId) continue;

      // publishedAt は Date に正規化（無ければ update/ create に入れない）
      const publishedAt =
        r.publishedAt
          ? new Date(typeof r.publishedAt === "string" ? r.publishedAt : r.publishedAt)
          : undefined;

      // upsert: null/undefined は data から落とす
      const dataCommon = defined({
        title: r.title ?? undefined,
        url: r.url ?? undefined,
        thumbnailUrl: r.thumbnailUrl ?? undefined,
        durationSec: r.durationSec ?? undefined,
        channelTitle: r.channelTitle ?? undefined,
        views: r.views ?? undefined,
        likes: r.likes ?? undefined,
        ...(publishedAt ? { publishedAt } : {}),
      });

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        create: defined({
          platform,
          platformVideoId,
          ...dataCommon,
        }),
        update: dataCommon,
      });

      upserts++;
      if (!publishedAt) skippedNoPublishedAt++;
    }

    logInfo("snapshot done", { hours, limit, query, upserts, skippedNoPublishedAt });
    return NextResponse.json({
      ok: true,
      route: "cron/snapshot",
      params: { hours, limit, query },
      fetched: results.length,
      upserts,
      skippedNoPublishedAt,
    });
  } catch (e: any) {
    logError("snapshot failed", { msg: String(e?.message || e) });
    return NextResponse.json({ ok: false, route: "cron/snapshot", error: String(e?.message || e) }, { status: 500 });
  }
}
