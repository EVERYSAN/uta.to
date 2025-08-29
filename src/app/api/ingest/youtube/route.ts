import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET() {
  // MVP確認用のダミー応答（まずはビルドを通す）
  return NextResponse.json({ ok: true, message: "ingest-youtube: ready" });
}
const prisma = new PrismaClient();

// 検索クエリ（まずは「歌ってみた」固定でMVP）
const QUERY = '歌ってみた';

export const dynamic = 'force-dynamic'; // Vercelで常にサーバ処理

async function fetchYouTube({ q, publishedAfter, pageToken }: {
  q: string; publishedAfter?: string; pageToken?: string;
}) {
  const params = new URLSearchParams({
    key: process.env.YOUTUBE_API_KEY!,
    part: 'snippet',
    maxResults: '25',
    type: 'video',
    q,
    order: 'date',
    ...(publishedAfter ? { publishedAfter } : {}),
    ...(pageToken ? { pageToken } : {}),
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`YouTube API error ${res.status}`);
  return res.json() as Promise<any>;
}

async function fetchVideoDetails(ids: string[]) {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({
    key: process.env.YOUTUBE_API_KEY!,
    part: 'contentDetails,statistics,snippet',
    id: ids.join(','),
    maxResults: '50',
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`YouTube videos API error ${res.status}`);
  const json = await res.json();
  return json.items ?? [];
}

// ISO8601 PT#M#S → 秒
function durationToSec(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return undefined;
  const h = parseInt(m[1] ?? '0', 10);
  const mi = parseInt(m[2] ?? '0', 10);
  const s = parseInt(m[3] ?? '0', 10);
  return h * 3600 + mi * 60 + s;
}

export async function GET() {
  try {
    // 直近6時間の新着を対象（Cronで頻回に叩く想定）
    const publishedAfter = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    let pageToken: string | undefined = undefined;
    let inserted = 0;
    let scanned = 0;

    for (let page = 0; page < 2; page++) { // MVP: 2ページだけ
      const search = await fetchYouTube({ q: QUERY, publishedAfter, pageToken });
      const ids = (search.items ?? []).map((it: any) => it.id?.videoId).filter(Boolean);
      scanned += ids.length;

      const details = await fetchVideoDetails(ids);
      for (const v of details) {
        const vid = v.id;
        const sn = v.snippet;
        const stats = v.statistics ?? {};
        const cd = v.contentDetails ?? {};

        // クリエイターUpsert
        const channelId = sn.channelId as string;
        const creator = await prisma.creator.upsert({
          where: { platform_platformUserId: { platform: 'youtube', platformUserId: channelId } },
          update: {
            name: sn.channelTitle ?? 'Unknown',
            thumbnailUrl: undefined,
          },
          create: {
            platform: 'youtube',
            platformUserId: channelId,
            name: sn.channelTitle ?? 'Unknown',
          }
        });

        // 動画Upsert
        const publishedAt = new Date(sn.publishedAt);
        const url = `https://www.youtube.com/watch?v=${vid}`;
        const thumb = sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url;

        await prisma.video.upsert({
          where: { platform_platformVideoId: { platform: 'youtube', platformVideoId: vid } },
          update: {
            title: sn.title ?? '',
            description: sn.description ?? '',
            url,
            thumbnailUrl: thumb,
            durationSec: durationToSec(cd.duration),
            publishedAt,
            creatorId: creator.id,
            rawJson: v
          },
          create: {
            platform: 'youtube',
            platformVideoId: vid,
            title: sn.title ?? '',
            description: sn.description ?? '',
            url,
            thumbnailUrl: thumb,
            durationSec: durationToSec(cd.duration),
            publishedAt,
            creatorId: creator.id,
            rawJson: v
          }
        });

        // StatsSnapshot（最新の1本だけでもOK）
        await prisma.statsSnapshot.create({
          data: {
            videoId: (await prisma.video.findUniqueOrThrow({
              where: { platform_platformVideoId: { platform: 'youtube', platformVideoId: vid } },
              select: { id: true }
            })).id,
            views: stats.viewCount ? parseInt(stats.viewCount, 10) : null,
            likes: stats.likeCount ? parseInt(stats.likeCount, 10) : null,
            comments: stats.commentCount ? parseInt(stats.commentCount, 10) : null,
            bookmarks: null
          }
        });

        inserted++;
      }

      pageToken = search.nextPageToken;
      if (!pageToken) break;
    }

    return NextResponse.json({ ok: true, scanned, inserted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

