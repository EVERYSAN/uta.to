// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_QUERY = "歌ってみた";
const DEFAULT_PAGES = 5;
const DEFAULT_LOOKBACK_HOURS = 72; // DBが空のときのフェールバック

// ---- helpers ----
function getApiKeys(): string[] {
  const keys =
    process.env.YOUTUBE_API_KEYS ??
    process.env.YOUTUBE_API_KEY ??
    "";
  return keys.split(",").map(s => s.trim()).filter(Boolean);
}

function parseBool(sp: URLSearchParams, key: string) {
  const v = sp.get(key);
  return v === "1" || v === "true" || v === "yes";
}

function iso(d: Date | string | number) {
  return new Date(d).toISOString();
}

function authOK(req: Request) {
  const fromVercelCron = req.headers.get("x-vercel-cron");
  if (fromVercelCron) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // ローカル/開発用。Vercel本番は必ず入れる
  const token = new URL(req.url).searchParams.get("token");
  return token === secret;
}

// ISO8601 duration -> seconds
function parseISODurationToSeconds(dur?: string): number | null {
  if (!dur) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(dur);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mm * 60 + s;
}

const INT_MAX = 2147483647;
function toIntOrNull(s?: string) {
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0 || i > INT_MAX) return null;
  return i;
}

async function fetchJson<T>(url: string) {
  const r = await fetch(url, { next: { revalidate: 0 } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}\n${text}`);
  }
  return (await r.json()) as T;
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

async function searchYoutubeSince(
  key: string,
  query: string,
  publishedAfterISO: string,
  maxPages: number,
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

// ---- handler ----
export async function GET(req: Request) {
  if (!authOK(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const debug = parseBool(sp, "debug");
  const dry = parseBool(sp, "dry");
  const pages = Number(sp.get("pages") ?? DEFAULT_PAGES);
  const query = sp.get("q") ?? DEFAULT_QUERY;
  const lookbackHours = Number(sp.get("lookbackHours") ?? DEFAULT_LOOKBACK_HOURS);
  const sinceParam = sp.get("since"); // 任意で上書きしたいとき

  const t0 = Date.now();
  const keys = getApiKeys();
  if (!keys.length) {
    return NextResponse.json({ ok: false, error: "Missing YOUTUBE_API_KEY(S)" }, { status: 500 });
  }

  // どこから取得するか（DBの最新publishedAtか、フェールバック）
  let since = new Date(Date.now() - lookbackHours * 3600_000); // fallback
  if (!sinceParam) {
    const latest = await prisma.video.findFirst({
      where: { platform: "youtube" },
      orderBy: { publishedAt: "desc" },
      select: { publishedAt: true },
    });
    if (latest?.publishedAt) {
      // 取りこぼし防止で fallback と比較して新しすぎないように
      const fb = since.getTime();
      since = new Date(Math.min(latest.publishedAt.getTime(), Date.now()));
      if (since.getTime() < fb) since = new Date(fb);
    }
  } else {
    since = new Date(sinceParam);
  }

  // 取得
  let items: YTSearchItem[] = [];
  let usedKey = "";
  let fetchErr: any = null;
  for (const key of keys) {
    try {
      usedKey = key;
      items = await searchYoutubeSince(key, query, iso(since), pages);
      if (items.length) break;
    } catch (e) {
      fetchErr = e;
      continue;
    }
  }
  if (!items.length && fetchErr) {
    return NextResponse.json({ ok: false, error: String(fetchErr) }, { status: 502 });
  }

  const videoIds = items.map(i => i.id?.videoId).filter(Boolean) as string[];
  const details = await getVideoDetails(usedKey || keys[0], videoIds);

  // Prisma に渡す形へマッピング
  const rows = items.map((i) => {
    const vid = i.id?.videoId!;
    const sn = i.snippet;
    const det = details.get(vid);
    const durSec = parseISODurationToSeconds(det?.contentDetails?.duration);

    return {
      title: sn?.title ?? "(no title)",
      channelTitle: sn?.channelTitle ?? null,
      url: `https://www.youtube.com/watch?v=${vid}`,
      thumbnailUrl: sn?.thumbnails?.high?.url ?? sn?.thumbnails?.medium?.url ?? null,
      durationSec: durSec ?? null,
      publishedAt: new Date(sn?.publishedAt ?? Date.now()),
      views: toIntOrNull(det?.statistics?.viewCount),
      likes: toIntOrNull(det?.statistics?.likeCount),
      platform: "youtube" as const,
    };
  });

  // 書き込み（重複で全体が落ちないように skipDuplicates）
  let inserted = 0;
  let prismaError: string | null = null;
  if (!dry && rows.length) {
    try {
      const result = await prisma.video.createMany({
        data: rows,
        skipDuplicates: true, // これが重要（URLにユニーク制約がある想定）
      });
      inserted = result.count ?? 0;
    } catch (e: any) {
      prismaError = String(e?.message ?? e);
    }
  }

  const body = {
    ok: !prismaError,
    meta: {
      now: iso(Date.now()),
      since: iso(since),
      query,
      pagesTried: pages,
      usedKey: usedKey ? `${usedKey.slice(0, 6)}…` : null,
      dryRun: dry,
      tookMs: Date.now() - t0,
    },
    counts: {
      fetched: items.length,
      toInsert: rows.length,
      inserted,
    },
    ...(debug ? { sample: rows.slice(0, 3) } : {}),
    error: prismaError,
  };

  return NextResponse.json(body, prismaError ? { status: 500 } : { status: 200 });
}
