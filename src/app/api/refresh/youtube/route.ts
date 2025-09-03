// src/app/api/refresh/youtube/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type YtSearchItem = {
  id?: { videoId?: string } | string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      maxres?: { url?: string };
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
};

type YtSearchResponse = {
  items?: YtSearchItem[];
  error?: { message?: string };
};

function pickThumb(it: YtSearchItem): string | undefined {
  const t = it.snippet?.thumbnails;
  return (
    t?.maxres?.url ??
    t?.high?.url ??
    t?.medium?.url ??
    t?.default?.url ??
    undefined
  );
}

function getVideoId(it: YtSearchItem): string | undefined {
  if (!it) return undefined;
  // search.list の標準は id.videoId
  if (typeof it.id === "object" && it.id?.videoId) return it.id.videoId;
  // 稀に id が string のケースも拾っておく
  if (typeof it.id === "string") return it.id;
  return undefined;
}

export async function GET(req: Request) {
  try {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "YOUTUBE_API_KEY is missing" },
        { status: 500 }
      );
    }

    const url = new URL(req.url);
    const hours = Math.max(1, Number(url.searchParams.get("hours") ?? 24)); // デフォルト24h
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 30))); // max 50
    const q = (url.searchParams.get("q") ?? "").trim();
    const channelId = (url.searchParams.get("channelId") ?? "").trim();

    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      key,
      part: "snippet",
      maxResults: String(limit),
      type: "video",
      order: "date",
      publishedAfter: since,
    });

    if (q) params.set("q", q);
    if (channelId) params.set("channelId", channelId);

    const apiUrl = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

    const res = await fetch(apiUrl, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, route: "refresh/youtube", error: `YouTube search failed: ${res.status}`, details: text.slice(0, 500) },
        { status: 500 }
      );
    }

    const data: YtSearchResponse = await res.json();
    const items = data.items ?? [];

    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const it of items) {
      const videoId = getVideoId(it);
      if (!videoId) {
        skipped++;
        continue;
      }

      const title = it.snippet?.title ?? "(no title)";
      const channelTitle = it.snippet?.channelTitle ?? undefined;
      // string → Date に正規化（なければ undefined）
      const publishedRaw = it.snippet?.publishedAt ?? undefined;
      const publishedAt = publishedRaw ? new Date(publishedRaw) : undefined;
      const thumbnailUrl = pickThumb(it);
      const url = `https://www.youtube.com/watch?v=${videoId}`;

      // 既存有無チェック（作成/更新のカウント用途）
      const exists = await prisma.video.findUnique({
        where: { platform_platformVideoId: { platform: "youtube", platformVideoId: videoId } },
        select: { id: true },
      });

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform: "youtube", platformVideoId: videoId } },
        create: {
          platform: "youtube",
          platformVideoId: videoId,
          title,
          url,
          ...(channelTitle ? { channelTitle } : {}),
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
          ...(publishedAt ? { publishedAt } : {}), // 値がある時だけ入れる
        },
        update: {
          title,
          url,
          ...(channelTitle ? { channelTitle } : {}),
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
          ...(publishedAt ? { publishedAt } : {}), // 同上
        },
      });

      processed++;
      if (exists) updated++;
      else created++;
    }

    return NextResponse.json({
      ok: true,
      route: "refresh/youtube",
      query: { q, channelId, hours, limit },
      since,
      counts: { processed, created, updated, skipped },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        route: "refresh/youtube",
        error: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}
