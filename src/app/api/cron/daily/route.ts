// src/app/api/cron/daily/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

/* ==============================
   設定（環境変数）
============================== */
// 収集シード（カンマ区切り）。デフォルトは「歌ってみた」「カバー/cover/covered」
const SEARCH_SEEDS: string[] = (process.env.CRON_YT_SEEDS ??
  String(`"歌ってみた",カバー,cover,covered`))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// タイトルの必須語（いずれかに一致でOK）※カンマ区切り
const TITLE_MUST_INCLUDE: string[] = (process.env.CRON_TITLE_MUST_INCLUDE ??
  "歌ってみた,歌ってみました,カバー,cover,covered")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// タイトルの除外語（任意）※カンマ区切り
const TITLE_MUST_EXCLUDE: string[] = (process.env.CRON_TITLE_MUST_EXCLUDE ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// 最大ページ（seedごと / 1ページ=最大50件）
const MAX_PAGES = Number(process.env.CRON_YT_MAX_PAGES ?? 5);

// 既定の遡り時間（時間）
const DEFAULT_LOOKBACK_HOURS = Number(process.env.CRON_LOOKBACK_HOURS ?? 72);

// YouTube API Keys（カンマ区切り or 単体環境変数）
const YT_KEYS = (() => {
  const raw =
    process.env.YOUTUBE_API_KEYS ??
    process.env.YOUTUBE_API_KEY ??
    process.env.YT_API_KEY ??
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
})();

/* ==============================
   ユーティリティ
============================== */
function getSecretForEnv() {
  const ve = process.env.VERCEL_ENV;
  if (ve === "production") return process.env.CRON_SECRET_PROD || process.env.CRON_SECRET;
  return process.env.CRON_SECRET_PREVIEW || process.env.CRON_SECRET;
}

function fail(status: number, msg: string, extra?: any) {
  return NextResponse.json({ ok: false, error: msg, ...extra }, { status });
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}\n${text}`);
  }
  return (await r.json()) as T;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 3600 * 1000);
}

function iso8601DurationToSec(iso?: string | null): number | undefined {
  if (!iso) return undefined;
  // e.g. PT1H2M30S
  const m = /P(?:([\d.]+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i.exec(iso);
  if (!m) return undefined;
  const d = Number(m[1] || 0);
  const h = Number(m[2] || 0);
  const min = Number(m[3] || 0);
  const s = Number(m[4] || 0);
  return d * 86400 + h * 3600 + min * 60 + s;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isAscii = (s: string) => /^[\x00-\x7F]+$/.test(s);
const normJa = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function hasAsciiWord(title: string, term: string) {
  // 英数字に挟まれていない（単語境界）で一致させる => "discovered" は "covered" に一致しない
  const re = new RegExp(`(^|[^A-Za-z0-9])${esc(term)}([^A-Za-z0-9]|$)`, "i");
  return re.test(title);
}

function containsTerm(title: string, term: string) {
  return isAscii(term) ? hasAsciiWord(title, term) : normJa(title).includes(normJa(term));
}

function isAllowedTitle(title?: string | null) {
  if (!title) return false;
  if (!TITLE_MUST_INCLUDE.some((t) => containsTerm(title, t))) return false;
  if (TITLE_MUST_EXCLUDE.length && TITLE_MUST_EXCLUDE.some((t) => containsTerm(title, t))) return false;
  return true;
}

/* ==============================
   YouTube API
============================== */
type YTSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } };
  };
};
type YTSearchResponse = {
  nextPageToken?: string;
  items?: YTSearchItem[];
};

type YTVideoItem = {
  id?: string;
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
};
type YTVideoResponse = { items?: YTVideoItem[] };

async function searchYoutubeSince(key: string, query: string, sinceISO: string, maxPages: number): Promise<YTSearchItem[]> {
  const base = "https://www.googleapis.com/youtube/v3/search";
  let pageToken: string | undefined;
  const out: YTSearchItem[] = [];
  for (let i = 0; i < maxPages; i++) {
    const u = new URL(base);
    u.searchParams.set("key", key);
    u.searchParams.set("part", "snippet");
    u.searchParams.set("type", "video");
    u.searchParams.set("maxResults", "50");
    u.searchParams.set("order", "date");
    u.searchParams.set("q", query);
    u.searchParams.set("publishedAfter", sinceISO);
    if (pageToken) u.searchParams.set("pageToken", pageToken);

    const json = await fetchJson<YTSearchResponse>(u.toString());
    if (json.items?.length) out.push(...json.items);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

async function getVideoDetailsBulk(key: string, ids: string[]): Promise<Record<string, YTVideoItem>> {
  const base = "https://www.googleapis.com/youtube/v3/videos";
  const out: Record<string, YTVideoItem> = {};
  // 50件ずつ
  for (let i = 0; i < ids.length; i += 50) {
    const slice = ids.slice(i, i + 50);
    const u = new URL(base);
    u.searchParams.set("key", key);
    u.searchParams.set("part", "contentDetails,statistics");
    u.searchParams.set("id", slice.join(","));
    const json = await fetchJson<YTVideoResponse>(u.toString());
    json.items?.forEach((it) => {
      if (it.id) out[it.id] = it;
    });
  }
  return out;
}

/* ==============================
   DB: Support列の存在チェック & 再計算
============================== */
async function detectSupportColumns() {
  // information_schema から Video テーブルの列存在を確認
  const cols = await prisma.$queryRaw<
    { column_name: string }[]
  >`SELECT column_name FROM information_schema.columns WHERE table_name = 'Video' OR table_name = 'video'`;
  const names = new Set(cols.map((c) => c.column_name.toLowerCase()));
  const has = (n: string) => names.has(n.toLowerCase());
  return {
    hasSupportCount: has("supportCount"),
    hasSupportTotal: has("supportTotal"),
    hasSupport1d: has("support1d"),
    hasSupport7d: has("support7d"),
    hasSupport30d: has("support30d"),
  };
}

async function recomputeSupportColumns(now = new Date()) {
  const exists = await detectSupportColumns();
  const hasAny =
    exists.hasSupportCount ||
    exists.hasSupportTotal ||
    exists.hasSupport1d ||
    exists.hasSupport7d ||
    exists.hasSupport30d;

  if (!hasAny) {
    return { ok: true, has: exists, updated: 0 };
  }

  const t1d = addHours(now, -24);
  const t7d = addHours(now, -24 * 7);
  const t30d = addHours(now, -24 * 30);

  const byAll = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    _count: { videoId: true },
  });
  const by1d = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: { createdAt: { gte: t1d } },
    _count: { videoId: true },
  });
  const by7d = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: { createdAt: { gte: t7d } },
    _count: { videoId: true },
  });
  const by30d = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: { createdAt: { gte: t30d } },
    _count: { videoId: true },
  });

  const mapAll = new Map(byAll.map((r) => [r.videoId, r._count.videoId]));
  const map1d = new Map(by1d.map((r) => [r.videoId, r._count.videoId]));
  const map7d = new Map(by7d.map((r) => [r.videoId, r._count.videoId]));
  const map30d = new Map(by30d.map((r) => [r.videoId, r._count.videoId]));

  // すべての videoId をユニオンして更新
  const ids = new Set<string>();
  [mapAll, map1d, map7d, map30d].forEach((m) => m.forEach((_, k) => ids.add(k)));

  let updated = 0;
  for (const id of ids) {
    const data: Prisma.VideoUpdateInput = {};
    if (exists.hasSupportCount || exists.hasSupportTotal) {
      // 両者がある場合は同値に（プロジェクトに合わせて使い分け）
      const total = mapAll.get(id) ?? 0;
      if (exists.hasSupportCount) (data as any).supportCount = total;
      if (exists.hasSupportTotal) (data as any).supportTotal = total;
    }
    if (exists.hasSupport1d) (data as any).support1d = map1d.get(id) ?? 0;
    if (exists.hasSupport7d) (data as any).support7d = map7d.get(id) ?? 0;
    if (exists.hasSupport30d) (data as any).support30d = map30d.get(id) ?? 0;

    if (Object.keys(data).length > 0) {
      await prisma.video.update({ where: { id }, data });
      updated++;
    }
  }

  return { ok: true, has: exists, updated };
}

/* ==============================
   取り込み（INGEST）
============================== */
async function ingestYouTube(sinceISO: string, dryRun = false) {
  if (YT_KEYS.length === 0) {
    throw new Error("No YouTube API key. Set YOUTUBE_API_KEYS / YOUTUBE_API_KEY / YT_API_KEY");
  }

  // 1) 複数シードで収集 → 重複除去
  const seen = new Map<string, YTSearchItem>();
  for (const seed of SEARCH_SEEDS) {
    let lastErr: unknown = null;
    for (const key of YT_KEYS) {
      try {
        const its = await searchYoutubeSince(key, seed, sinceISO, MAX_PAGES);
        for (const it of its) {
          const vid = it?.id?.videoId;
          if (vid && !seen.has(vid)) seen.set(vid, it);
        }
        lastErr = null;
        break; // このシードは成功
      } catch (e) {
        lastErr = e;
        continue; // キー切替
      }
    }
    if (lastErr) {
      console.warn("[daily] seed_failed:", seed, String(lastErr));
    }
  }

  let items = Array.from(seen.values());

  // 2) タイトル厳密フィルタ
  items = items.filter((i) => isAllowedTitle(i?.snippet?.title));

  const videoIds = items.map((i) => i?.id?.videoId).filter(Boolean) as string[];
  const details =
    videoIds.length > 0 ? await getVideoDetailsBulk(YT_KEYS[0], videoIds) : {};

  // 3) DB upsert 用データ生成
  type Row = Prisma.VideoUncheckedCreateInput;
  const rows: Row[] = [];
  for (const it of items) {
    const id = it?.id?.videoId;
    if (!id) continue;
    const sn = it.snippet ?? {};
    const det = details[id];
    const durationSec = iso8601DurationToSec(det?.contentDetails?.duration);
    const views = det?.statistics?.viewCount ? Number(det.statistics.viewCount) : undefined;
    const likes = det?.statistics?.likeCount ? Number(det.statistics.likeCount) : undefined;

    const thumb =
      sn.thumbnails?.high?.url ||
      sn.thumbnails?.medium?.url ||
      sn.thumbnails?.default?.url ||
      undefined;

    rows.push({
      platform: "youtube",
      platformVideoId: id,
      title: sn.title ?? "",
      channelTitle: sn.channelTitle ?? "",
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnailUrl: thumb,
      durationSec,
      publishedAt: sn.publishedAt ? new Date(sn.publishedAt) : new Date(),
      views,
      likes,
    });
  }

  if (dryRun) {
    return {
      ok: true,
      fetched: items.length,
      toUpsert: rows.length,
      created: 0,
      updated: 0,
      dryRun: true,
    };
  }

  // 4) upsert（既存は更新・新規は作成）
  let created = 0;
  let updated = 0;

  // 既存の platformVideoId を先に拾って upsert パスを分岐
  const existing = await prisma.video.findMany({
    where: { platform: "youtube", platformVideoId: { in: videoIds } },
    select: { id: true, platformVideoId: true },
  });
  const existingSet = new Set(existing.map((e) => e.platformVideoId));

  // upsert（ひとつずつ：件数は抑制的なので安全重視）
  for (const r of rows) {
    const where = { platform_platformVideoId: { platform: "youtube", platformVideoId: r.platformVideoId } } as any;

    // Prisma のユニーク制約名はプロジェクトに依存するので、
    // なければ platform + platformVideoId の複合ユニークを作っておくことを推奨。
    // ここではフォールバックで findFirst->create/update の2段にする。
    try {
      const exists = existingSet.has(r.platformVideoId);
      if (exists) {
        await prisma.video.update({
          where: where,
          data: {
            title: r.title,
            channelTitle: r.channelTitle,
            url: r.url,
            thumbnailUrl: r.thumbnailUrl,
            durationSec: r.durationSec,
            publishedAt: r.publishedAt,
            views: r.views,
            likes: r.likes,
          },
        });
        updated++;
      } else {
        await prisma.video.create({ data: r });
        created++;
      }
    } catch {
      // 複合ユニーク名が違う/無い場合のフォールバック
      const hit = await prisma.video.findFirst({
        where: { platform: "youtube", platformVideoId: r.platformVideoId },
        select: { id: true },
      });
      if (hit) {
        await prisma.video.update({
          where: { id: hit.id },
          data: {
            title: r.title,
            channelTitle: r.channelTitle,
            url: r.url,
            thumbnailUrl: r.thumbnailUrl,
            durationSec: r.durationSec,
            publishedAt: r.publishedAt,
            views: r.views,
            likes: r.likes,
          },
        });
        updated++;
      } else {
        await prisma.video.create({ data: r });
        created++;
      }
    }
  }

  return { ok: true, fetched: items.length, toUpsert: rows.length, created, updated };
}

/* ==============================
   Route Handler
============================== */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || "";
  const dry = url.searchParams.get("dry") === "1";
  const hoursParam = url.searchParams.get("lookbackHours");
  const sinceParam = url.searchParams.get("since"); // ISO指定も可

  const expected = getSecretForEnv();
  if (!expected || secret !== expected) {
    return fail(401, "unauthorized");
  }

  const now = new Date();
  const since =
    sinceParam ? new Date(sinceParam) : addHours(now, -(hoursParam ? Number(hoursParam) : DEFAULT_LOOKBACK_HOURS));
  const sinceISO = since.toISOString();

  const steps: any = {};

  try {
    // ingest
    steps.ingest = await ingestYouTube(sinceISO, dry);

    // support 再計算（列がある環境のみ）
    if (!dry) {
      steps.recomputeSupport = await recomputeSupportColumns(now);
    } else {
      steps.recomputeSupport = { ok: true, skipped: true, reason: "dryRun" };
    }

    // ここで再検証やタグの revalidate をやりたい場合は
    // ISR 使用時に next/cache のタグ名に合わせて叩く（本プロジェクトは no-store 運用）

    return NextResponse.json({
      ok: true,
      now: now.toISOString(),
      windows: { since: sinceISO },
      ...steps,
    });
  } catch (e: any) {
    return fail(500, "internal_error", { message: String(e?.message || e) });
  }
}
