/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

/** このルートは URL/ヘッダ参照があるため静的化不可 */
export const dynamic = "force-dynamic";

/* ========= 設定 ========= */
/**
 * クエリは「歌ってみた」「cover」「covered」「coverd」のみに絞る
 * 追加・削除したいときは CRON_YT_QUERY="foo|bar|baz" でも上書き可能
 */
const QUERY = process.env.CRON_YT_QUERY ?? "歌ってみた|cover|covered|coverd";
const QUERIES: string[] = QUERY.split("|").map((s) => s.trim()).filter(Boolean);

const MAX_PAGES = Number(process.env.CRON_YT_MAX_PAGES ?? 5);
const DEFAULT_LOOKBACK_HOURS = Number(process.env.CRON_LOOKBACK_HOURS ?? 72);

// 海外動画をできる限り除外（日本向けを優先）
const YT_REGION = process.env.CRON_YT_REGION ?? "JP";
const YT_LANG = process.env.CRON_YT_LANG ?? "ja";

/* ========= 型 ========= */
type YTSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
  };
};

type YTVideosItem = {
  id: string;
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
};

type IngestResult = {
  ok: boolean;
  fetched: number;
  toUpsert: number;
  created: number;
  updated: number;
  dryRun?: boolean;
  reason?: string;
};

type CronSteps = {
  ingest?: IngestResult;
  recomputeSupport?:
    | { ok: true; skipped: true }
    | { ok: boolean; updated?: number; reason?: string };
};

/* ========= ヘルパー ========= */

// 日本語らしさ判定（タイトル/チャンネル名にひらがな・カタカナ・漢字が含まれるか）
function isLikelyJapanese(text: string | undefined): boolean {
  if (!text) return false;
  return /[\u3040-\u30FF\u4E00-\u9FFF]/.test(text);
}

// ISO8601 Duration → 秒 ("PT3M12S" → 192)
function iso8601DurationToSec(dur?: string): number | undefined {
  if (!dur) return undefined;
  // PnDTnHnMnS 形式の素朴パース
  const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return undefined;
  const day = Number(m[1] ?? 0);
  const hour = Number(m[2] ?? 0);
  const min = Number(m[3] ?? 0);
  const sec = Number(m[4] ?? 0);
  return day * 86400 + hour * 3600 + min * 60 + sec;
}

// no-store のみ（revalidate は併用しない）で warning 回避
async function fetchJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}\n${body}`);
  }
  return res.json() as Promise<T>;
}

function iso(d: Date): string {
  // 小数秒なしの ISO (YouTube API にそのまま渡せる)
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}T${z(
    d.getUTCHours()
  )}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}.000Z`;
}

/* ========= YouTube API ========= */

async function searchYoutubeSince(
  key: string,
  query: string,
  publishedAfterISO: string,
  maxPages: number
) {
  const items: YTSearchItem[] = [];
  let pageToken = "";

  // 「歌ってみた」はフレーズ一致を少し強化（ノイズ低減）
  const qValue = query === "歌ってみた" ? `"${query}"` : query;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("key", key);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("order", "date");
    url.searchParams.set("regionCode", YT_REGION);        // 日本地域優先
    url.searchParams.set("relevanceLanguage", YT_LANG);   // 日本語優先
    url.searchParams.set("q", qValue);
    url.searchParams.set("publishedAfter", publishedAfterISO);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const json = await fetchJson<any>(url.toString());
    (json.items as YTSearchItem[] | undefined)?.forEach((it) => items.push(it));
    pageToken = json.nextPageToken ?? "";
    if (!pageToken) break;
  }

  return items;
}

async function getVideoDetails(
  key: string,
  ids: string[]
): Promise<Record<string, YTVideosItem>> {
  const map: Record<string, YTVideosItem> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  for (const chunk of chunks) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("key", key);
    url.searchParams.set("part", "contentDetails,statistics");
    url.searchParams.set("id", chunk.join(","));
    const json = await fetchJson<any>(url.toString());
    (json.items as YTVideosItem[] | undefined)?.forEach((it) => {
      map[it.id] = it;
    });
  }
  return map;
}

/* ========= 取り込み本体 ========= */

async function ingestYouTube(sinceISO: string, dry: boolean): Promise<IngestResult> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: "no_api_key",
      fetched: 0,
      toUpsert: 0,
      created: 0,
      updated: 0,
    };
  }

  // 1) 複数クエリで検索 → 集約
  const all: YTSearchItem[] = [];
  for (const q of QUERIES) {
    const got = await searchYoutubeSince(apiKey, q, sinceISO, MAX_PAGES);
    all.push(...got);
  }

  // 2) videoId 重複排除
  const byId = new Map<string, YTSearchItem>();
  for (const it of all) {
    const vid = it?.id?.videoId;
    if (!vid) continue;
    byId.set(vid, it); // 後来優先でOK
  }
  let deduped = Array.from(byId.values());

  // 3) 日本語らしさでフィルタ（海外除外の強化）
  deduped = deduped.filter((it) => {
    const sn = it.snippet ?? {};
    return isLikelyJapanese(sn.title) || isLikelyJapanese(sn.channelTitle);
  });

  // 4) 詳細取得（duration/views/likes）
  const ids = deduped.map((i) => i?.id?.videoId!).filter(Boolean);
  const details = ids.length ? await getVideoDetails(apiKey, ids) : {};

  // 5) DB 行へマッピング
  const rows = deduped
    .map((it) => {
      const id = it?.id?.videoId;
      if (!id) return null;
      const sn = it.snippet ?? {};
      const det = details[id];

      const durationSec = iso8601DurationToSec(det?.contentDetails?.duration);
      const views = det?.statistics?.viewCount
        ? Number(det.statistics.viewCount)
        : undefined;
      const likes = det?.statistics?.likeCount
        ? Number(det.statistics.likeCount)
        : undefined;
      const thumb =
        sn.thumbnails?.high?.url ||
        sn.thumbnails?.medium?.url ||
        sn.thumbnails?.default?.url ||
        undefined;

      return {
        platform: "youtube" as const,
        platformVideoId: id,
        title: sn.title ?? "",
        channelTitle: sn.channelTitle ?? "",
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl: thumb,
        durationSec,
        publishedAt: sn.publishedAt ? new Date(sn.publishedAt) : new Date(),
        views,
        likes,
      };
    })
    .filter(Boolean) as {
      platform: "youtube";
      platformVideoId: string;
      title: string;
      channelTitle: string;
      url: string;
      thumbnailUrl?: string;
      durationSec?: number;
      publishedAt: Date;
      views?: number;
      likes?: number;
    }[];

  if (dry) {
    return {
      ok: true,
      fetched: all.length,
      toUpsert: rows.length,
      created: 0,
      updated: 0,
      dryRun: true,
    };
  }

  const prisma = new PrismaClient();
  try {
    // 既存のユニーク制約（platform, platformVideoId）がある前提で skipDuplicates
    const created = await prisma.video.createMany({
      data: rows,
      skipDuplicates: true,
    });

    return {
      ok: true,
      fetched: all.length,
      toUpsert: rows.length,
      created: created.count,
      updated: 0,
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

/* ========= 応援の再計算（最小・安全なスタブ） ========= */
/** 既存 UI は groupBy 合成対応済みのため、ここは安全にスキップ */
async function recomputeSupportSafe(): Promise<{ ok: true; skipped: true }> {
  return { ok: true, skipped: true };
}

/* ========= 認証 ========= */
/**
 * Vercel Cron のヘッダ or secret クエリで許可。
 * CRON_SECRET / CRON_SECRET_PROD / CRON_SECRET_PREVIEW のいずれか一致で OK。
 * 未設定時（ローカル等）は無認証で通す。
 */
function ensureCronAuth(req: Request): { ok: boolean; via: string } {
  const url = new URL(req.url);
  const secretQ = url.searchParams.get("secret") ?? undefined;
  const hdr = req.headers.get("x-cron-secret") ?? undefined; // 任意
  const cronHdr = req.headers.get("x-vercel-cron");

  const allow = [
    process.env.CRON_SECRET,
    process.env.CRON_SECRET_PROD,
    process.env.CRON_SECRET_PREVIEW,
  ].filter(Boolean) as string[];

  // Vercel の Cron はヘッダで判定可
  if (cronHdr) return { ok: true, via: "x-vercel-cron" };

  // シークレット未設定なら許可（開発用途）
  if (allow.length === 0) return { ok: true, via: "no-secret" };

  // 何か一致すれば OK
  const provided = [secretQ, hdr].filter(Boolean) as string[];
  if (provided.some((p) => allow.includes(p))) return { ok: true, via: "secret" };

  // UA に古い Cron の痕跡があれば保険で許容（不要なら削除OK）
  const ua = req.headers.get("user-agent") ?? "";
  if (/vercel-cron/i.test(ua)) return { ok: true, via: "ua-fallback" };

  return { ok: false, via: "mismatch" };
}

/* ========= ルート ========= */

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // 認証
    const auth = ensureCronAuth(req as unknown as Request);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", via: auth.via },
        { status: 401 }
      );
    }

    // パラメータ
    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    const hoursParam = url.searchParams.get("lookbackHours");
    const sinceParam = url.searchParams.get("since");

    // 期間
    const now = new Date();
    const sinceDate = sinceParam
      ? new Date(sinceParam)
      : new Date(
          now.getTime() -
            Number(hoursParam ?? DEFAULT_LOOKBACK_HOURS) * 60 * 60 * 1000
        );
    const sinceISO = iso(sinceDate);

    const steps: CronSteps = {};

    // 1) 取り込み
    steps.ingest = await ingestYouTube(sinceISO, dry);

    // 2) 応援再計算（今はスキップ運用）
    steps.recomputeSupport = await recomputeSupportSafe();

    return NextResponse.json(
      {
        ok: true,
        now: now.toISOString(),
        env: { vercelEnv: process.env.VERCEL_ENV ?? "unknown" },
        windows: { since: sinceISO },
        ...steps,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    // YouTube の 403（quotaExceeded）などもここに来る
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
