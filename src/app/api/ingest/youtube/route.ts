// src/app/api/ingest/youtube/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const API_KEY = process.env.YOUTUBE_API_KEY!;
const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

// ISO8601 の PT◯H◯M◯S を秒に
function iso8601ToSec(iso?: string | null): number | null {
  if (!iso) return null;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mm * 60 + s;
}

export async function GET(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json({ error: "YOUTUBE_API_KEY is missing" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "歌ってみた";
  const maxResults = Math.min(50, Math.max(1, parseInt(searchParams.get("maxResults") ?? "50", 10)));
  const pageToken = searchParams.get("pageToken") ?? "";

  // 1) 検索（動画IDとスニペット）
  const sUrl =
    `${SEARCH_URL}?key=${API_KEY}&part=snippet&type=video&order=date` +
    `&maxResults=${maxResults}&q=${encodeURIComponent(q)}` +
    (pageToken ? `&pageToken=${pageToken}` : "");

  const sRes = await fetch(sUrl);
  if (!sRes.ok) {
    return NextResponse.json({ error: await sRes.text() }, { status: 500 });
  }
  const sJson: any = await sRes.json();
  const items: any[] = sJson.items ?? [];
  const ids = items.map((it) => it?.id?.videoId).filter(Boolean) as string[];

  // 2) 統計と長さをまとめて取得（最大50件）
  let statsMap = new Map<
    string,
    { views: number; likes: number; durationSec: number | null }
  >();

  if (ids.length) {
    const vUrl = `${VIDEOS_URL}?key=${API_KEY}&part=statistics,contentDetails&id=${ids.join(",")}`;
    const vRes = await fetch(vUrl);
    if (!vRes.ok) {
      return NextResponse.json({ error: await vRes.text() }, { status: 500 });
    }
    const vJson: any = await vRes.json();
    for (const v of vJson.items ?? []) {
      const id: string = v.id;
      const st = v.statistics ?? {};
      const cd = v.contentDetails ?? {};
      statsMap.set(id, {
        views: parseInt(st.viewCount ?? "0", 10) || 0,
        likes: parseInt(st.likeCount ?? "0", 10) || 0,
        durationSec: iso8601ToSec(cd.duration),
      });
    }
  }

  // 3) upsert（views / likes / channelTitle も保存）
  for (const it of items) {
    const vid: string | undefined = it?.id?.videoId;
    if (!vid) continue;
    const sn = it.snippet ?? {};
    const stats = statsMap.get(vid) ?? { views: 0, likes: 0, durationSec: null };

    const title = sn.title ?? "";
    const url = `https://www.youtube.com/watch?v=${vid}`;
    const thumb =
      sn?.thumbnails?.high?.url ??
      sn?.thumbnails?.medium?.url ??
      sn?.thumbnails?.default?.url ??
      null;
    const publishedAt = sn.publishedAt ? new Date(sn.publishedAt) : new Date();
    const channelTitle = sn.channelTitle ?? "";

    await prisma.video.upsert({
      where: {
        platform_platformVideoId: {
          platform: "YOUTUBE",
          platformVideoId: vid,
        },
      },
      create: {
        platform: "YOUTUBE",
        platformVideoId: vid,
        title,
        url,
        thumbnailUrl: thumb,
        durationSec: stats.durationSec,
        publishedAt,
        channelTitle,
        views: stats.views,
        likes: stats.likes,
      },
      update: {
        title,
        thumbnailUrl: thumb,
        durationSec: stats.durationSec,
        publishedAt,
        channelTitle,
        views: stats.views,
        likes: stats.likes,
      },
    });
  }

  return NextResponse.json({
    saved: ids.length,
    nextPageToken: sJson.nextPageToken ?? null,
  });
}
