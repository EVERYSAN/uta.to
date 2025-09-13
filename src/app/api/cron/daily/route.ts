// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ========= 設定 ========= */
const QUERY = process.env.CRON_YT_QUERY ?? "歌ってみた";
const MAX_PAGES = Number(process.env.CRON_YT_MAX_PAGES ?? 5);
const DEFAULT_LOOKBACK_HOURS = Number(process.env.CRON_LOOKBACK_HOURS ?? 72);

/* ========= 共通ユーティリティ ========= */
const iso = (d: Date | string | number) => new Date(d).toISOString();

function getApiKeys(): string[] {
  const keys =
    process.env.YOUTUBE_API_KEYS ??
    process.env.YOUTUBE_API_KEY ??
    process.env.YT_API_KEY ?? // 互換
    "";
  return keys.split(",").map(s => s.trim()).filter(Boolean);
}

async function fetchJson<T>(url: string) {
  const r = await fetch(url, { next: { revalidate: 0 } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}\n${text}`);
  }
  return (await r.json()) as T;
}

function parseISODurationToSeconds(dur?: string): number | undefined {
  if (!dur) return undefined;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(dur);
  if (!m) return undefined;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mn = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mn * 60 + s;
}

function toIntUndef(s?: string): number | undefined {
  if (s == null) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/* ========= YouTube API ========= */
type YTSearchItem = {
  id: { videoId?: string };
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
    (json.items as any[] | undefined)?.forEach(i => items.push(i));
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
    (json.items as any[] | undefined)?.forEach(it => map.set(it.id, it));
  }
  return map;
}

/* ========= Cron 認証（後方互換） ========= */
function expectedSecrets(): string[] {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const arr = [];
  if (env === "production" && process.env.CRON_SECRET_PROD) arr.push(process.env.CRON_SECRET_PROD);
  if (env === "preview" && process.env.CRON_SECRET_PREVIEW) arr.push(process.env.CRON_SECRET_PREVIEW);
  if (process.env.CRON_SECRET) arr.push(process.env.CRON_SECRET);
  return arr.filter(Boolean) as string[];
}

function ensureCronAuth(req: Request): { ok: boolean; via: string } {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";   // 旧互換
  const secret = url.searchParams.get("secret") ?? ""; // 新
  const hdr =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("x-cron-secret") ||
    "";
  const cronHdr = req.headers.get("x-vercel-cron");
  const ua = req.headers.get("user-agent") ?? "";

  const allow = expectedSecrets();
  if (cronHdr) return { ok: true, via: "x-vercel-cron" };
  if (allow.length === 0) return { ok: true, via: "no-secret" };
  const provided = [token, secret, hdr].filter(Boolean);
  if (provided.some(p => allow.includes(p))) return { ok: true, via: "secret" };
  if (/vercel-cron/i.test(ua)) return { ok: true, via: "ua-fallback" };
  return { ok: false, via: "mismatch" };
}

/* ========= Support 再計算（新ロジックを継承） ========= */
async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
    table,
    column
  );
  return !!rows?.[0]?.exists;
}

async function detectVideoTotalCols(): Promise<{
  countCol?: "supportCount";
  totalCol?: "supportTotal" | "supportPoints";
}> {
  const hasCount = await columnExists("video", "supportcount").catch(() => false);
  const hasTotal = await columnExists("video", "supporttotal").catch(() => false);
  const hasPoints = await columnExists("video", "supportpoints").catch(() => false);
  return {
    countCol: hasCount ? "supportCount" : undefined,
    totalCol: hasTotal ? "supportTotal" : hasPoints ? "supportPoints" : undefined,
  };
}

async function detectWindows() {
  const w1d = await columnExists("video", "support1d").catch(() => false);
  const w7d = await columnExists("video", "support7d").catch(() => false);
  const w30d = await columnExists("video", "support30d").catch(() => false);
  return { w1d, w7d, w30d };
}

async function detectSEPoints(): Promise<boolean> {
  return columnExists("supportevent", "points").catch(() => false);
}

async function updateTotals(
  opts: {
    countCol?: "supportCount";
    totalCol?: "supportTotal" | "supportPoints";
    seHasPoints: boolean;
  },
  dryRun: boolean
) {
  if (dryRun || (!opts.countCol && !opts.totalCol)) {
    return { updatedViaJoin: 0, zeroFilled: 0, setExprForCount: "n/a", setExprForPoints: "n/a" };
  }

  const exprCount = `COUNT(*)::int`;
  const exprPoints = opts.seHasPoints ? `SUM(COALESCE(se.points, 1))::int` : `COUNT(*)::int`;

  const setPieces: string[] = [];
  if (opts.countCol) setPieces.push(`"${opts.countCol}" = c.cnt`);
  if (opts.totalCol) setPieces.push(`"${opts.totalCol}" = c.pts`);
  const setLine = setPieces.join(", ") || `"id" = v.id`; // no-op

  const updatedViaJoin = await prisma.$executeRawUnsafe<number>(`
    WITH counts AS (
      SELECT "videoId" AS vid, ${exprCount} AS cnt, ${exprPoints} AS pts
      FROM "SupportEvent" se
      GROUP BY "videoId"
    )
    UPDATE "Video" v
    SET ${setLine}
    FROM counts c
    WHERE v.id = c.vid
  `);

  const zeroSet: string[] = [];
  if (opts.countCol) zeroSet.push(`"${opts.countCol}" = 0`);
  if (opts.totalCol) zeroSet.push(`"${opts.totalCol}" = 0`);
  const zeroLine = zeroSet.join(", ");

  let zeroFilled = 0;
  if (zeroLine) {
    zeroFilled = await prisma.$executeRawUnsafe<number>(`
      UPDATE "Video" v
      SET ${zeroLine}
      WHERE NOT EXISTS (SELECT 1 FROM "SupportEvent" se WHERE se."videoId" = v.id)
    `);
  }

  return { updatedViaJoin, zeroFilled, setExprForCount: exprCount, setExprForPoints: exprPoints };
}

type WindowStat = { updatedViaJoin: number; zeroFilled: number };

async function updateWindow(
  col: "support1d" | "support7d" | "support30d",
  intervalSql: string,
  dryRun: boolean
): Promise<WindowStat> {
  const exists = await columnExists("video", col.toLowerCase()).catch(() => false);
  if (!exists || dryRun) return { updatedViaJoin: 0, zeroFilled: 0 };

  const updatedViaJoin = await prisma.$executeRawUnsafe<number>(`
    WITH counts AS (
      SELECT "videoId" AS vid, COUNT(*)::int AS cnt
      FROM "SupportEvent"
      WHERE "createdAt" >= NOW() - ${intervalSql}
      GROUP BY "videoId"
    )
    UPDATE "Video" v
    SET "${col}" = c.cnt
    FROM counts c
    WHERE v.id = c.vid
  `);

  const zeroFilled = await prisma.$executeRawUnsafe<number>(`
    UPDATE "Video" v
    SET "${col}" = 0
    WHERE NOT EXISTS (
      SELECT 1
      FROM "SupportEvent" se
      WHERE se."videoId" = v.id
        AND se."createdAt" >= NOW() - ${intervalSql}
    )
  `);

  return { updatedViaJoin, zeroFilled };
}

async function rebuildSearchVector(dryRun: boolean): Promise<boolean> {
  const has = await columnExists("video", "searchvector").catch(() => false);
  if (!has || dryRun) return false;
  await prisma.$executeRawUnsafe(`
    UPDATE "Video" v
    SET "searchVector" = to_tsvector('simple',
      coalesce(v.title, '') || ' ' || coalesce(v."channelTitle", '')
    )
  `);
  return true;
}

/* ========= ルート ========= */
export async function GET(req: Request) {
  // 認可（旧・新のどちらでも通す）
  const auth = ensureCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const debug = url.searchParams.get("debug") === "1";

  // 取り込み期間：DBの最新 publishedAt から -1h（取りこぼし対策）／無ければ既定
  const latest = await prisma.video.findFirst({
    select: { publishedAt: true },
    orderBy: { publishedAt: "desc" },
  });
  const sinceDate = latest?.publishedAt
    ? new Date(latest.publishedAt.getTime() - 60 * 60 * 1000)
    : new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000);
  const sinceISO = iso(sinceDate);

  /* ---- 1) YouTube取り込み（旧ロジックを復活） ---- */
  let ingest = { ok: true as const, skipped: false, added: 0, updated: 0 };
  try {
    const keys = getApiKeys();
    if (keys.length === 0) throw new Error("no_youtube_api_key");

    let items: YTSearchItem[] = [];
    for (const key of keys) {
      try {
        items = await searchYoutubeSince(key, QUERY, sinceISO, MAX_PAGES);
        break;
      } catch {
        // 別キーでリトライ
        continue;
      }
    }
    const ids = items.map(i => i.id?.videoId).filter(Boolean) as string[];

    // 詳細（duration / stats）
    let detailMap = new Map<string, YTVideosItem>();
    for (const key of keys) {
      try {
        detailMap = await getVideoDetails(key, ids);
        break;
      } catch {
        continue;
      }
    }

    const rows: Prisma.VideoCreateManyInput[] = items
      .map(i => {
        const vid = i.id?.videoId;
        if (!vid) return null;
        const sn = i.snippet;
        const det = detailMap.get(vid);
        const durSec = parseISODurationToSeconds(det?.contentDetails?.duration);
        const thumb =
          sn.thumbnails?.high?.url ??
          sn.thumbnails?.medium?.url ??
          undefined;

        return {
          platform: "youtube",
          platformVideoId: vid,
          title: sn.title,
          channelTitle: sn.channelTitle,
          url: `https://www.youtube.com/watch?v=${vid}`,
          thumbnailUrl: thumb,
          durationSec: durSec,
          publishedAt: new Date(sn.publishedAt ?? Date.now()),
          views: toIntUndef(det?.statistics?.viewCount),
          likes: toIntUndef(det?.statistics?.likeCount),
        } satisfies Prisma.VideoCreateManyInput;
      })
      .filter((x): x is Prisma.VideoCreateManyInput => x !== null);

    if (!dryRun && rows.length > 0) {
      const res = await prisma.video.createMany({ data: rows, skipDuplicates: true });
      ingest.added = res.count;
      ingest.updated = rows.length - res.count;
    } else {
      ingest.skipped = true;
    }
  } catch (e: any) {
    ingest = { ok: false as const, skipped: true, added: 0, updated: 0 };
  }

  /* ---- 2) Support合計/期間の再計算（新ロジック） ---- */
  let recompute: any = { ok: true };
  try {
    const seHasPoints = await detectSEPoints();
    const totalsCols = await detectVideoTotalCols();
    const windows = await detectWindows();

    const totals = await updateTotals(
      { countCol: totalsCols.countCol, totalCol: totalsCols.totalCol, seHasPoints },
      dryRun
    );

    const winStat: { d1?: WindowStat; d7?: WindowStat; d30?: WindowStat } = {};
    if (windows.w1d) winStat.d1 = await updateWindow("support1d", `INTERVAL '1 day'`, dryRun);
    if (windows.w7d) winStat.d7 = await updateWindow("support7d", `INTERVAL '7 days'`, dryRun);
    if (windows.w30d) winStat.d30 = await updateWindow("support30d", `INTERVAL '30 days'`, dryRun);

    recompute = { ok: true, has: { ...totalsCols, sePointsColumn: seHasPoints }, totals, windows: winStat };
  } catch (e: any) {
    recompute = { ok: false, error: String(e) };
  }

  /* ---- 3) 検索ベクタ再構築（存在すれば） ---- */
  let rebuildSearch = { ok: true, skipped: true };
  try {
    const changed = await rebuildSearchVector(dryRun);
    rebuildSearch = { ok: true, skipped: !changed };
  } catch (e: any) {
    rebuildSearch = { ok: false, error: String(e) } as any;
  }

  /* ---- 4) revalidate（タグ運用している場合） ---- */
  try {
    if (!dryRun) {
      revalidateTag("video:list");
      revalidateTag("video:24h");
    }
  } catch {}

  return NextResponse.json(
    {
      ok: true,
      meta: {
        now: iso(Date.now()),
        since: sinceISO,
        env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
        dryRun,
      },
      steps: { ingest, recomputeSupport: recompute, rebuildSearch, revalidate: { ok: true } },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
