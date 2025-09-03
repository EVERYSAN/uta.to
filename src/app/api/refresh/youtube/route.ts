import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const YT_KEY =
  process.env.YT_API_KEY ||
  process.env.YOUTUBE_API_KEY ||
  process.env.NEXT_PUBLIC_YT_API_KEY ||
  "";

type YtSearchItem = {
  id?: { videoId?: string } | string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
  };
};

export async function GET(req: Request) {
  const url = new URL(req.url);

  const hours = Math.max(1, Math.min(48, Number(url.searchParams.get("hours")) || 6));
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 32));
  const query = (url.searchParams.get("query") || process.env.YT_DEFAULT_QUERY || "").trim();

  if (!YT_KEY) {
    return NextResponse.json(
      { ok: false, route: "refresh/youtube", error: "Missing YT_API_KEY (or YOUTUBE_API_KEY)" },
      { status: 200 }
    );
  }

  const publishedAfter = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const params = new URLSearchParams({
    key: YT_KEY,
    part: "snippet",
    type: "video",
    order: "date",
    maxResults: String(limit),
    publishedAfter,
  });

  if (query) {
    params.set("q", query);
  } else {
    params.set("videoCategoryId", "10"); // Music
    if (process.env.YT_REGION_CODE) params.set("regionCode", process.env.YT_REGION_CODE);
  }

  const apiUrl = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

  try {
    const res = await fetch(apiUrl, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          route: "refresh/youtube",
          status: res.status,
          error: `YouTube search failed: ${res.status}`,
          detail: text.slice(0, 500),
        },
        { status: 200 }
      );
    }

    const json: { items?: YtSearchItem[] } = await res.json();
    const items = json.items ?? [];
    let upserts = 0;

    for (const it of items) {
      const videoId =
        typeof it.id === "string" ? it.id : it.id?.videoId || "";
      if (!videoId) continue;

      const title = it.snippet?.title || `video ${videoId}`;
      const channelTitle = it.snippet?.channelTitle || undefined;
      const publishedAt = it.snippet?.publishedAt
        ? new Date(it.snippet.publishedAt)
        : undefined;
      const thumb =
        it.snippet?.thumbnails?.high?.url ??
        it.snippet?.thumbnails?.medium?.url ??
        undefined;
      const url = `https://www.youtube.com/watch?v=${videoId}`;

      // ---- ここがポイント：値があるときだけプロパティを含める ----
      const createData: Prisma.VideoCreateInput = {
        platform: "youtube",
        platformVideoId: videoId,
        title,
        url,
        ...(channelTitle ? { channelTitle } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        ...(thumb ? { thumbnailUrl: thumb } : {}),
      };

      const updateData: Prisma.VideoUpdateInput = {
        title,
        url,
        ...(channelTitle ? { channelTitle } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        ...(thumb ? { thumbnailUrl: thumb } : {}),
      };

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform: "youtube", platformVideoId: videoId } },
        create: createData,
        update: updateData,
      });

      upserts++;
    }

    return NextResponse.json({
      ok: true,
      route: "refresh/youtube",
      fetched: items.length,
      upserts,
      hours,
      limit,
      usedQuery: query || null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, route: "refresh/youtube", error: e?.message || String(e) },
      { status: 200 }
    );
  }
}
