// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";

// ---- Next.js 実行設定（SSG で実行されないように）----
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- 設定値 ----
const QUERY = "歌ってみた";
const MAX_PAGES = 5;
const DEFAULT_LOOKBACK_HOURS = 72;

// 複数キーをカンマ区切りで与えられる
function getApiKeys(): string[] {
  const keys =
    process.env.YOUTUBE_API_KEYS ??
    process.env.YOUTUBE_API_KEY ??
    "";
  return keys
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function iso(d: Date | string | number) {
  return new Date(d).toISOString();
}

// --- 認可チェック（名称変更で衝突回避）---
function ensureCronAuth(req: Request): { ok: boolean; via: string } {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  const cronHdr = req.headers.get("x-vercel-cron");
  const ua = req.headers.get("user-agent") ?? "";

  if (cronHdr) return { ok: true, via: "x-vercel-cron" }; // Vercel Cron の自動実行
  if (!secret) return { ok: true, via: "no-secret" };     // シークレット未設定なら許可（暫定）
  if (token && token === secret) return { ok: true, via: "query-token" };
  if (/vercel-cron/i.test(ua)) return { ok: true, via: "ua-fallback" };
  return { ok: false, via: "mismatch" };
}

// ISO8601期間 → 秒（PT#H#M#S の簡易パーサ）
function parseISODurationToSeconds(dur?: string): number | undefined {
  if (!dur) return undefined;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(dur);
  if (!m) return undefined;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mn = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mn * 60 + s;
}

async function fetchJson<T>(url: string) {
  const r = await fetch(url, { next: { revalidate: 0 } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}\n${text}`);
  }
  return (await r.json()) as T;
}

// --- YouTube API 型 ---
type YTSearchItem = {
  id: { videoId?: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails?: {
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
};

type YTVideosItem = {
  id: string;
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
};

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

function toIntUndef(s?: string): number | undefined {
  if (s == null) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: Request) {
  // 認可（ensureCronAuth に変更）
  const auth = ensureCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const dryRun = url.searchParams.get("dry") === "1";

  // どこから取りに行くか：DB の最新 publishedAt から少し巻き戻す。無ければ既定の lookback
  const lookbackHours =
    Number(url.searchParams.get("lookbackHours") ?? "") ||
    Number(process.env.CRON_LOOKBACK_HOURS ?? "") ||
    DEFAULT_LOOKBACK_HOURS;

  const latest = await prisma.video.findFirst({
    select: { publishedAt: true },
    orderBy: { publishedAt: "desc" },
  });

  const sinceDate =
    latest?.publishedAt
      ? new Date(latest.publishedAt.getTime() - 60 * 60 * 1000) // 取りこぼし防止で -1h
      : new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const sinceISO = iso(sinceDate);

  // APIキーを順に試す
  const keys = getApiKeys();
  if (keys.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_youtube_api_key" },
      { status: 500 }
    );
    }

  let items: YTSearchItem[] = [];
  let usedKey = "";
  let pagesTried = 0;

  for (const key of keys) {
    try {
      items = await searchYoutubeSince(key, QUERY, sinceISO, MAX_PAGES);
      usedKey = key.replace(/.(?=.{4})/g, "•"); // 末尾4桁以外マスク
      pagesTried = MAX_PAGES;
      break;
    } catch {
      usedKey = "(failed key hidden)";
      pagesTried++;
      continue;
    }
  }

  // 取得ID一覧
  const ids = items.map((i) => i.id?.videoId).filter(Boolean) as string[];

  // 詳細を 50件ずつ取得
  let detailMap = new Map<string, YTVideosItem>();
  for (const key of keys) {
    try {
      detailMap = await getVideoDetails(key, ids);
      break;
    } catch {
      continue;
    }
  }

  // Prisma に渡す形へ
  const rows: Prisma.VideoCreateManyInput[] = items
    .map((i) => {
      const vid = i.id?.videoId;
      if (!vid) return null;

      const sn = i.snippet;
      const det = detailMap.get(vid);

      const durSec = parseISODurationToSeconds(det?.contentDetails?.duration);
      const thumb =
        sn.thumbnails?.high?.url ??
        sn.thumbnails?.medium?.url ??
        undefined;

      const data: Prisma.VideoCreateManyInput = {
        platform: "youtube",
        platformVideoId: vid,
        title: sn.title,
        channelTitle: sn.channelTitle,
        url: `https://www.youtube.com/watch?v=${vid}`,
        thumbnailUrl: thumb,             // undefined を許容
        durationSec: durSec,             // undefined を許容
        publishedAt: new Date(sn.publishedAt ?? Date.now()),
        views: toIntUndef(det?.statistics?.viewCount),
        likes: toIntUndef(det?.statistics?.likeCount),
      };
      return data;
    })
    .filter((x): x is Prisma.VideoCreateManyInput => x !== null);

  let inserted = 0;
  let skipped = 0;

  if (!dryRun && rows.length > 0) {
    const res = await prisma.video.createMany({
      data: rows,
      skipDuplicates: true,
    });
    inserted = res.count;
    skipped = rows.length - inserted;
  } else {
    skipped = rows.length;
  }

  // ISR/キャッシュを明示的に更新（タグはあなたの実装に合わせて）
  try {
    revalidateTag("video:list");
    revalidateTag("video:24h");
  } catch {
    // 失敗しても処理は続行
  }

  const resBody = {
    ok: true,
    meta: {
      now: iso(Date.now()),
      since: sinceISO,
      query: QUERY,
      pagesTried,
      usedKey,
      dryRun,
    },
    counts: {
      fetched: items.length,
      inserted,
      skipped,
    },
    ...(debug ? { sample: rows.slice(0, 3) } : {}),
  };

  return NextResponse.json(resBody, { status: 200 });
}
