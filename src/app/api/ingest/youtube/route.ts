import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic"; // Vercelで常にSSR/サーバ実行

// YouTube 検索条件（まずは固定キーワードでMVP）
const QUERY = "歌ってみた";

// ISO8601 PT#H#M#S → 秒
function durationToSec(iso?: string): number | null {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] ?? "0", 10);
  const mi = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + mi * 60 + s;
}

async function searchYouTube({ q, publishedAfter, pageToken }: { q: string; publishedAfter?: string; pageToken?: string }) {
  const params = new URLSearchParams({
    key: process.env.YOUTUBE_API_KEY!,
    part: "snippet",
    maxResults: "25",
    type: "video",
    q,
    order: "date",
    ...(publishedAfter ? { publishedAfter } : {}),
    ...(pageToken ? { pageToken } : {}),
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`YouTube search error ${res.status}`);
  return (await res.json()) as any;
}

async function fetchVideoDetails(ids: string[]) {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({
    key: process.env.YOUTUBE_API_KEY!,
    part: "contentDetails,statistics,snippet",
    id: ids.join(","),
    maxResults: "50",
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`YouTube videos error ${res.status}`);
  const json = await res.json();
  return json.items ?? [];
}

export async function GET() {
  try {
    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json({ ok: false, error: "YOUTUBE_API_KEY is missing" }, { status: 400 });
    }

    // 直近6時間の新着
    const publishedAfter = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    let pageToken: string | undefined = undefined;
    let scanned = 0;
    let upserts = 0;

    // 2ページ分だけ取得（API制限のため）
    for (let round = 0; round < 2; round++) {
      const searchJson = await searchYouTube({ q: QUERY, publishedAfter, pageToken });
      const items: any[] = searchJson.items ?? [];
      scanned += items.length;

      const ids = items.map((it) => it.id?.videoId).filter(Boolean) as string[];
      const details = await fetchVideoDetails(ids);

      for (const d of details) {
        const id = d.id as string;
        const snippet = d.snippet ?? {};
        const statistics = d.statistics ?? {};
        const contentDetails = d.contentDetails ?? {};

        const data = {
          platform: "youtube" as const,
          platformVideoId: id,
          title: snippet.title ?? "",
          description: snippet.description ?? "",
          url: `https://www.youtube.com/watch?v=${id}`,
          thumbnailUrl:
            (snippet.thumbnails?.maxres?.url ??
              snippet.thumbnails?.high?.url ??
              snippet.thumbnails?.medium?.url ??
              snippet.thumbnails?.default?.url) ?? null,
          publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : new Date(),
          durationSec: durationToSec(contentDetails.duration),
          // 追加カラム
          channelTitle: snippet.channelTitle ?? "",
          views: statistics.viewCount ? parseInt(statistics.viewCount, 10) : 0,
          likes: statistics.likeCount ? parseInt(statistics.likeCount, 10) : 0,
        };

        await prisma.video.upsert({
          where: { platform_platformVideoId: { platform: "youtube", platformVideoId: id } },
          create: data,
          update: data,
        });
        upserts++;
      }

      pageToken = searchJson.nextPageToken;
      if (!pageToken) break;
    }

    return NextResponse.json({ ok: true, scanned, upserts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
