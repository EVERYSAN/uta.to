// src/app/api/ingest/youtube/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type YtSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    publishedAt?: string;
    channelTitle?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
};

type YtVideosItem = {
  id: string;
  statistics?: { viewCount?: string; likeCount?: string };
  contentDetails?: { duration?: string }; // ISO8601
};

function iso8601DurationToSec(iso?: string | null): number | null {
  if (!iso) return null;
  // ざっくりISO8601 PT#H#M#S → 秒
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] ?? "0", 10);
  const mi = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + mi * 60 + s;
}
function isAuthorized(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("secret");
  const h = req.headers.get("x-cron-secret");
  if (q && q === process.env.CRON_SECRET) return true;
  if (h && h === process.env.CRON_SECRET) return true;
  if (req.headers.get("x-vercel-cron") === "1") return true;
  return false;
}

export async function GET(req: Request) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "YOUTUBE_API_KEY is not set" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "歌ってみた";
  // 直近何時間分を取得するか（既定48h）
  const sinceHours = Math.max(
    1,
    parseInt(searchParams.get("sinceHours") ?? "48", 10)
  );
  // search のページ数（最大10回）
  const maxPages = Math.min(
    10,
    Math.max(1, parseInt(searchParams.get("maxPages") ?? "5", 10))
  );
  // 取得後に videos.list で統計を更新するか
  const withStats = (searchParams.get("withStats") ?? "1") === "1";

  const publishedAfter = new Date(
    Date.now() - sinceHours * 60 * 60 * 1000
  ).toISOString();

  // ---- 1) search.list で直近動画を収集（最大 maxPages*50 件） ----
  const collected: YtSearchItem[] = [];
  let pageToken: string | undefined;

  for (let i = 0; i < maxPages; i++) {
    const u = new URL("https://www.googleapis.com/youtube/v3/search");
    u.searchParams.set("key", apiKey);
    u.searchParams.set("part", "snippet");
    u.searchParams.set("type", "video");
    u.searchParams.set("maxResults", "50");
    u.searchParams.set("order", "date");
    u.searchParams.set("publishedAfter", publishedAfter);
    u.searchParams.set("q", q);
    if (pageToken) u.searchParams.set("pageToken", pageToken);

    const res = await fetch(u.toString());
    const json = await res.json();

    const items: YtSearchItem[] = json?.items ?? [];
    collected.push(...items);

    pageToken = json?.nextPageToken;
    if (!pageToken) break;
  }

  // videoId 抜き出し
  const ids = collected
    .map((it) => it.id?.videoId)
    .filter((v): v is string => !!v);

  // ---- 2) DB upsert（基本情報）----
  // Prisma の複合ユニーク（@@unique([platform, platformVideoId])）を想定
  const upserts = [];
  for (const it of collected) {
    const id = it.id?.videoId;
    if (!id) continue;
    const sn = it.snippet ?? {};
    const title = sn.title ?? "(no title)";
    const publishedAt = sn.publishedAt ? new Date(sn.publishedAt) : new Date();
    const channelTitle = sn.channelTitle ?? "";
    const thumb =
      sn.thumbnails?.high?.url ||
      sn.thumbnails?.medium?.url ||
      sn.thumbnails?.default?.url ||
      `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
    const url = `https://www.youtube.com/watch?v=${id}`;

    upserts.push(
      prisma.video.upsert({
        where: {
          platform_platformVideoId: { platform: "youtube", platformVideoId: id },
        },
        update: {
          title,
          url,
          thumbnailUrl: thumb,
          publishedAt,
          channelTitle,
          // views/likes は後で更新するのでここでは触らない
        },
        create: {
          platform: "youtube",
          platformVideoId: id,
          title,
          url,
          thumbnailUrl: thumb,
          durationSec: null, // 後で videos.list で入れる
          publishedAt,
          channelTitle,
          views: 0,
          likes: 0,
        },
      })
    );
  }
  if (upserts.length > 0) {
    // 大量でも安全に流すため逐次でもOK。速度重視なら $transaction でも可。
    for (const job of upserts) {
      await job;
    }
  }

  // ---- 3) videos.list で statistics, contentDetails を更新（任意）----
  let updated = 0;
  if (withStats && ids.length > 0) {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const vurl = new URL("https://www.googleapis.com/youtube/v3/videos");
      vurl.searchParams.set("key", apiKey);
      vurl.searchParams.set("part", "statistics,contentDetails");
      vurl.searchParams.set("id", chunk.join(","));

      const r = await fetch(vurl.toString());
      const j = await r.json();
      const vs: YtVideosItem[] = j?.items ?? [];

      for (const v of vs) {
        const views = v.statistics?.viewCount
          ? parseInt(v.statistics.viewCount, 10)
          : 0;
        const likes = v.statistics?.likeCount
          ? parseInt(v.statistics.likeCount, 10)
          : 0;
        const durationSec = iso8601DurationToSec(v.contentDetails?.duration);

        await prisma.video.update({
          where: {
            platform_platformVideoId: {
              platform: "youtube",
              platformVideoId: v.id,
            },
          },
          data: {
            views,
            likes,
            durationSec,
          },
        });
        updated++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    q,
    sinceHours,
    maxPages,
    withStats,
    collected: ids.length,
    updated,
  });
}

