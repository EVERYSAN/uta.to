// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 重要：SSG 化で実行されないのを防ぐ
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- 設定 ----
const QUERY = "歌ってみた"; // 検索語
const MAX_PAGES = 5;        // 1ページ=最大50件 / 様子を見て増減
const DEFAULT_LOOKBACK_HOURS = 72; // 取りこぼし防止の既定窓

// 複数キーをカンマ区切りで渡せます（先頭から使い切り）
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

function requireCronAuth(req: Request) {
  // どちらか満たせばOK
  const fromVercelCron = req.headers.get("x-vercel-cron"); // Vercel Cron の自動ヘッダ
  const token = new URL(req.url).searchParams.get("token");
  const secret = process.env.CRON_SECRET;
  if (fromVercelCron) return true;
  if (!secret) return true; // シークレット未設定なら許可（開発用）
  return token === secret;
}

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

// ISO8601期間 → 秒
function parseISODurationToSeconds(dur?: string): number | null {
  if (!dur) return null;
  // 簡易パーサ（PT#H#M#S）
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(dur);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mnt = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mnt * 60 + s;
}

async function fetchJson<T>(url: string) {
  const r = await fetch(url, { next: { revalidate: 0 } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}\n${text}`);
  }
  return (await r.json()) as T;
}

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
  // 50件ずつ
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

import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma"; // あなたのプロジェクトのパスに合わせて

export async function GET(req: Request) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const dryRun = url.searchParams.get("dry") === "1";
  const explicitSince = url.searchParams.get("since");

  const keys = getApiKeys();
  if (keys.length === 0) {
    return NextResponse.json(
      { ok: false, error: "YOUTUBE_API_KEY(S) not set" },
      { status: 500 }
    );
  }


  // 既定の探索開始点：DBの最新 publishedAt か、なければ now - DEFAULT_LOOKBACK_HOURS
  const latest = await prisma.video.findFirst({
    select: { publishedAt: true },
    orderBy: { publishedAt: "desc" },
  });

  const now = new Date();
  const fallbackFrom = new Date(now.getTime() - DEFAULT_LOOKBACK_HOURS * 3600 * 1000);
  const since =
    explicitSince ? new Date(explicitSince) : latest?.publishedAt ?? fallbackFrom;

  // YouTube から検索（キーを順繰りで使用）
  let searchItems: YTSearchItem[] = [];
  let usedKey = "";
  let pagesTried = 0;
  let lastError: unknown = null;

  for (const key of keys) {
    try {
      usedKey = key;
      const res = await searchYoutubeSince(key, QUERY, iso(since), MAX_PAGES);
      searchItems = res;
      pagesTried = Math.min(MAX_PAGES, Math.ceil(res.length / 50));
      if (res.length > 0) break; // 取れた
    } catch (e) {
      lastError = e;
      continue; // 次のキーへ
    }
  }

  if (searchItems.length === 0 && lastError) {
    // 1件も取れずにエラーなら、その詳細を返す
    return NextResponse.json(
      { ok: false, error: String(lastError) },
      { status: 500 }
    );
  }

  // 詳細情報（duration / stats）を取得
  const videoIds = searchItems
    .map((i) => i.id?.videoId)
    .filter(Boolean) as string[];
  const detailsMap = await getVideoDetails(usedKey || keys[0], videoIds);

  // DB へ流し込み用に整形
  const records = searchItems.map((it) => {
    const id = it.id?.videoId!;
    const s = it.snippet;
    const d = detailsMap.get(id);
    const durationSec = parseISODurationToSeconds(d?.contentDetails?.duration);
    const views = d?.statistics?.viewCount ? Number(d.statistics.viewCount) : null;
    const likes = d?.statistics?.likeCount ? Number(d.statistics.likeCount) : null;

    const thumb =
      s.thumbnails?.high?.url ||
      s.thumbnails?.medium?.url ||
      null;

    return {
      // Prisma の型に依存しすぎないよう、存在する想定カラムを素直に詰める
      title: s.title,
      channelTitle: s.channelTitle,
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnailUrl: thumb,
      durationSec: durationSec ?? null,
      publishedAt: new Date(s.publishedAt),
      views,
      likes,
      // 将来用に platform を持っているなら…
      platform: "youtube",
    };
  });

  // インサート
  let inserted = 0;
  let skipped = 0;
  let errorMsg: string | undefined;

  if (!dryRun && records.length > 0) {
    try {
      // url をユニークキーにしていれば skipDuplicates で重複抑止
      const result = await prisma.video.createMany({
        data: records as any,
        skipDuplicates: true,
      });
      inserted = result.count;
      skipped = Math.max(0, records.length - inserted);
    } catch (e: any) {
      errorMsg = e?.message || String(e);
    }
  }

  return NextResponse.json({
    ok: true,
    meta: {
      now: iso(now),
      since: iso(since),
      query: QUERY,
      pagesTried,
      usedKey: usedKey ? `${usedKey.slice(0, 6)}…` : null,
      dryRun,
    },
    counts: {
      fetched: records.length,
      inserted,
      skipped,
    },
    // debug=1 の時だけ詳細返却
    items: debug
      ? records.map((r) => ({
          title: r.title,
          url: r.url,
          publishedAt: iso(r.publishedAt!),
          durationSec: r.durationSec,
          views: r.views,
          likes: r.likes,
        }))
      : undefined,
    error: errorMsg,
  });
}
