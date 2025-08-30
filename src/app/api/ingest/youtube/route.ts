// src/app/api/ingest/youtube/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const API = "https://www.googleapis.com/youtube/v3";

function parseISODuration(iso?: string | null) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const min = m[1] ? parseInt(m[1], 10) : 0;
  const sec = m[2] ? parseInt(m[2], 10) : 0;
  return min * 60 + sec;
}

export async function GET(req: NextRequest) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "MISSING_API_KEY" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "歌ってみた";
  const maxResults = Math.min(50, Math.max(1, parseInt(searchParams.get("maxResults") ?? "50", 10)));
  const pageToken = searchParams.get("pageToken") ?? undefined;

  // 1) search で id を拾う
  const searchUrl = new URL(`${API}/search`);
  searchUrl.search = new URLSearchParams({
    key,
    q,
    part: "id",
    type: "video",
    maxResults: String(maxResults),
    order: "date",
    ...(pageToken ? { pageToken } : {}),
  }).toString();

  const sRes = await fetch(searchUrl, { cache: "no-store" });
  const sJson = await sRes.json();
  const ids: string[] = (sJson.items ?? [])
    .map((it: any) => it.id?.videoId)
    .filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, upserts: 0, nextPageToken: sJson.nextPageToken ?? null });
  }

  // 2) videos で詳細＋統計
  const videosUrl = new URL(`${API}/videos`);
  videosUrl.search = new URLSearchParams({
    key,
    id: ids.join(","),
    part: "snippet,contentDetails,statistics",
  }).toString();

  const vRes = await fetch(videosUrl, { cache: "no-store" });
  const vJson = await vRes.json();

  let upserts = 0;

  for (const v of vJson.items ?? []) {
    const id = v.id as string;
    const snippet = v.snippet ?? {};
    const contentDetails = v.contentDetails ?? {};
    const statistics = v.statistics ?? {};

    const title = snippet.title ?? "";
    const description = snippet.description ?? "";
    const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt) : new Date();
    const thumbnailUrl =
      snippet.thumbnails?.maxres?.url ||
      snippet.thumbnails?.standard?.url ||
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.default?.url ||
      null;

    const durationSec = parseISODuration(contentDetails.duration);
    const channelTitle = snippet.channelTitle ?? "";
    const views = statistics.viewCount ? parseInt(statistics.viewCount, 10) : 0;
    const likes = statistics.likeCount ? parseInt(statistics.likeCount, 10) : 0;

    await prisma.video.upsert({
      where: {
        platform_platformVideoId: {
          platform: "youtube",
          platformVideoId: id,
        },
      },
      update: {
        platform: "youtube",
        title,
        description,
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl,
        durationSec,
        publishedAt,
        channelTitle,
        views,
        likes,
      },
      create: {
        platform: "youtube",
        platformVideoId: id,
        title,
        description,
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl,
        durationSec,
        publishedAt,
        channelTitle,
        views,
        likes,
      },
    });

    upserts++;
  }

  return NextResponse.json({
    ok: true,
    scanned: ids.length,
    upserts,
    nextPageToken: sJson.nextPageToken ?? null,
  });
}
