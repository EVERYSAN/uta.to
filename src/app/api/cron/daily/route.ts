// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 実行環境/キャッシュ
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// 必要なら長めに（プラン上限内で）
// export const maxDuration = 60;

// ---- 設定 ----
const QUERY = "歌ってみた";             // 検索語
const MAX_PAGES = 5;                    // search API: 1ページ=最大50件
const DEFAULT_LOOKBACK_HOURS = 72;      // 取りこぼし防止の既定窓

// ---- ユーティリティ ----
type YTSearchItem = {
  id: { videoId: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails?: { medium?: { url?: string }; high?: { url?: string } };
  };
};
type YTVideosItem = {
  id: string;
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
};

function getApiKeys(): string[] {
  const keys =
    process.env.YOUTUBE_API_KEYS ??
    process.env.YOUTUBE_API_KEY ??
    process.env.YT_API_KEY ??
    "";
  return keys.split(",").map((s) => s.trim()).filter(Boolean);
}
function iso(d: Date | string | number) {
  return new Date(d).toISOString();
}
function parseISODurationToSeconds(dur?: string): number | null {
  if (!dur) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(dur);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mi = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mi * 60 + s;
}
async function fetchJson<T>(url: string) {
  const r = await fetch(url, { next: { revalidate: 0 } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}\n${text}`);
  }
  return (await r.json()) as T;
}

// 認証: Authorization: Bearer <CRON_SECRET> または ?token=<CRON_SECRET>
function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // シークレット未設定なら許可（開発用）

  // Header（Vercel Cron が自動付与）
  const auth = req.headers.get("authorization") || "";
  const okHeader = auth.toLowerCase().startsWith("bearer ") &&
    auth.slice(7).trim() === secret;

  if (okHeader) return true;

  // 手動実行テスト用（ブラウザから）
  const token = new URL(req.url).searchParams.get("token");
  if (token && token === secret) return true;

  return false;
}

// YouTube Search: publishedAfter 以降を取得（最大 maxPages）
async function searchYoutubeSince(
  key: string,
  query: string,
  publishedAfterISO: string,
  maxPages: number
) {
  const items: YTSearchItem[] = [];
  let pageToken = "";
  for (let page = 0; page < maxPages; page++) {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("key", key);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("order", "date");
    url.searchParams.set("q", query);
    url.searchParams.set("publishedAfter", publishedAfterISO);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const json = await fetchJson<any>(url.toString());
    (json.items as any[] | undefined)?.forEach((i) => items.push(i));
    pageToken = json.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return items;
}

// bulk video details
async function getVideoDetails(key: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, YTVideosItem>();
  const map = new Map<string, YTVideosItem>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("key", key);
    url.searchParams.set("part", "contentDetails,statistics");
    url.searchParams.set("id", chunk.join(","));
    const json = await fetchJson<any>(url.toString());
    (json.items as any[] | undefined)?.forEach((it) => {
      map.set(it.id, it);
    });
  }
  return map;
}

// ---- ルート本体 ----
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const dryRun = url.searchParams.get("dry") === "1";
  const lookbackHours =
    parseInt(url.searchParams.get("hours") || "", 10) || DEFAULT_LOOKBACK_HOURS;

  const now = new Date();
  const publishedAfter = new Date(now.getTime() - lookbackHours * 3600 * 1000);
  const keys = getApiKeys();
  if (keys.length === 0) {
    return NextResponse.json(
      { ok: false, error: "YOUTUBE_API_KEY(S) not set" },
      { status: 500 }
    );
  }

  const meta: any = {
    now: iso(now),
    since: iso(publishedAfter),
    query: QUERY,
    pagesTried: MAX_PAGES,
    usedKey: keys[0]?.slice(0, 6) + "…",
    dryRun,
  };

  try {
    // 1) 検索
    const searchItems = await searchYoutubeSince(
      keys[0],
      QUERY,
      iso(publishedAfter),
      MAX_PAGES
    );

    // 2) 詳細（duration, stats）
    const ids = Array.from(
      new Set(
        searchItems
          .map((i) => i.id?.videoId)
          .filter(Boolean)
      )
    ) as string[];
    const detailsMap = await getVideoDetails(keys[0], ids);

    // 3) DB保存用に整形
    const rows = ids.map((id) => {
      const s = searchItems.find((i) => i.id?.videoId === id)!.snippet;
      const d = detailsMap.get(id);
      const durationSec = parseISODurationToSeconds(d?.contentDetails?.duration);
      const views = d?.statistics?.viewCount ? Number(d.statistics.viewCount) : null;
      const likes = d?.statistics?.likeCount ? Number(d.statistics.likeCount) : null;
      const thumb =
        s.thumbnails?.high?.url ||
        s.thumbnails?.medium?.url ||
        null;
      return {
        youtubeId: id,
        title: s.title,
        channelTitle: s.channelTitle,
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl: thumb,
        durationSec,
        views,
        likes,
        publishedAt: new Date(s.publishedAt),
      };
    });

    // 4) 保存（createMany / skipDuplicates）
    const counts = { fetched: rows.length, inserted: 0, skipped: 0 };
    if (!dryRun && rows.length) {
      // モデル名は環境ごとに違う可能性があるので動的に探す
      const db: any = prisma as any;
      const model =
        db.video ?? db.videos ?? db.clip ?? db.clips ?? db.item ?? db.items;
      if (!model) {
        throw new Error(
          "Prisma model not found. prisma.video / prisma.clip などプロジェクトのモデル名に合わせて修正してください。"
        );
      }
      await model.createMany({
        data: rows,
        skipDuplicates: true, // unique 制約（youtubeId等）がある前提
      });
      counts.inserted = rows.length; // 厳密な挿入数が必要なら count 取得 or upsert へ変更
    }

    const body: any = { ok: true, meta, counts };
    if (debug) body.items = rows;
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
