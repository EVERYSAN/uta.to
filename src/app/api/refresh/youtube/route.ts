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
  if (typeof it.id === "object" && it.id?.videoId) return it.id.videoId;
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
    const hours = Math.max(1, Number(url.searchParams.get("hours") ?? 24));
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 30)));
    const q = (url.searchParams.get("q") ?? "").trim();
    const channelId = (url.searchParams.get("channelId") ?? "").trim();

    const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      key,
      part: "snippet",
      maxResults: String(limit),
      type: "video",
      order: "date",
      publishedAfter: sinceIso,
    });
    if (q) params.set("q", q);
    if (channelId) params.set("channelId", channelId);

    const apiUrl = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

    const res = await fetch(apiUrl, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          route: "refresh/youtube",
          error: `YouTube search failed: ${res.status}`,
          details: text.slice(0, 500),
        },
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
      const channelTitle = it.snippet?.channelTitle || undefined;
      const publishedRaw = it.snippet?.publishedAt || undefined;
      const publishedAt: Date | undefined = publishedRaw ? new Date(publishedRaw) : undefined;
      const thumbnailUrl = pickThumb(it);
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

      const exists = await prisma.video.findUnique({
        where: { platform_platformVideoId: { platform: "youtube", platformVideoId: videoId } },
        select: { id: true },
      });

      // --- create オブジェクトは後から条件付きで代入 ---
      const createData: any = {
        platform: "youtube",
        platformVideoId: videoId,
        title,
        url: watchUrl,
      };
      if (channelTitle) createData.channelTitle = channelTitle;
      if (thumbnailUrl) createData.thumbnailUrl = thumbnailUrl;
      if (publishedAt) createData.publishedAt = publishedAt; // Date を直接代入（Prisma は Date か ISO string を許容）

      // --- update オブジェクトも同様に ---
      const updateData: any = {
        title,
        url: watchUrl,
      };
      if (channelTitle) updateData.channelTitle = channelTitle;
      if (thumbnailUrl) updateData.thumbnailUrl = thumbnailUrl;
      if (publishedAt) updateData.publishedAt = publishedAt;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform: "youtube", platformVideoId: videoId } },
        create: createData,
        update: updateData,
      });

      processed++;
      exists ? updated++ : created++;
    }

    return NextResponse.json({
      ok: true,
      route: "refresh/youtube",
      query: { q, channelId, hours, limit },
      since: sinceIso,
      counts: { processed, created, updated, skipped },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, route: "refresh/youtube", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
