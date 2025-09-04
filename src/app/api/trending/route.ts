// src/app/api/trending/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const prisma = new PrismaClient();

type Range = "24h" | "7d" | "30d";
type Basis = "published" | "ingested" | "auto";
const hoursOf = (r: Range) => (r === "7d" ? 7 * 24 : r === "30d" ? 30 * 24 : 24);

// 空画面回避のため最大72hまで広げる（24h→48h→72h）
const FALLBACK_STEPS_HOURS = [0, 24, 48];

export async function GET(req: Request) {
  const url = new URL(req.url);

  // --- params ---
  const rangeParam = (url.searchParams.get("range") || "").toLowerCase();
  const range: Range = (["24h", "7d", "30d"] as const).includes(rangeParam as any)
    ? (rangeParam as Range)
    : "24h";

  // basis=published|ingested|auto（既定 auto）
  const basisParam = (url.searchParams.get("basis") || "auto").toLowerCase() as Basis;

  // shorts=exclude でも excludeShorts=1/true でもOK
  const shortsParam = (url.searchParams.get("shorts") || "").toLowerCase();
  const excludeShorts =
    shortsParam === "exclude" ||
    /^(1|true|yes)$/i.test(url.searchParams.get("excludeShorts") || "");

  const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1);
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || "24") || 24));

  const debug = url.searchParams.has("debug");
  const noFallback = url.searchParams.has("noFallback");

  // --- base window (UTC) ---
  const now = Date.now();
  const baseHours = hoursOf(range);
  const baseSince = new Date(now - baseHours * 3600_000);

  // 動的フィールド（publishedAt or createdAt）
  const timeFieldFor = (basis: Exclude<Basis, "auto">) =>
    basis === "ingested" ? ("createdAt" as const) : ("publishedAt" as const);

  // where ビルダー（basis/timeField と since を注入）
  const buildWhere = (basis: Exclude<Basis, "auto">, since: Date) => {
    const timeField = timeFieldFor(basis);
    // Prisma の型を避けるため any で動的キー
    const baseWhere: any = {
      platform: "youtube",
      [timeField]: { gte: since },
    };
    const excludeShortsWhere = excludeShorts
      ? {
          NOT: {
            OR: [
              // 未取得(durationSec<=0/null)は短尺扱いしない
              { AND: [{ durationSec: { gt: 0 } }, { durationSec: { lte: 60 } }] },
              { url: { contains: "/shorts/" } },
              { platformVideoId: { contains: "/shorts/" } },
            ],
          },
        }
      : {};
    return { AND: [baseWhere, excludeShortsWhere] };
  };

  // 24h の件数（basisごと）を必ず計測しておく
  // - published: 公開基準
  // - ingested: 入荷基準（createdAt）。schemaに createdAt が無い場合は追加を検討
  const count24hPublished = await prisma.video.count({
    where: { platform: "youtube" as any, publishedAt: { gte: baseSince } },
  });

  let count24hIngested = 0;
  try {
    // createdAt が無い環境でもビルドは通るよう any で回避
    count24hIngested = await prisma.video.count({
      where: { platform: "youtube" as any, ...( { createdAt: { gte: baseSince } } as any) },
    });
  } catch {
    // createdAt が無い場合は 0 のまま（デバッグで気づけるようにする）
    count24hIngested = 0;
  }

  // basis を決定（auto のときは published→ingested の順で使える方を選ぶ）
  let effectiveBasis: Exclude<Basis, "auto"> =
    basisParam === "published" || basisParam === "ingested"
      ? basisParam
      : count24hPublished > 0
      ? "published"
      : count24hIngested > 0
      ? "ingested"
      : "published"; // どちらも0なら published を基準にしつつ後で時間窓を広げる

  // フォールバック窓（0=そのまま, +24h, +48h）
  let effectiveSince = baseSince;
  let effectiveHours = baseHours;

  // noFallback のときは窓を広げない
  if (!noFallback) {
    for (const step of FALLBACK_STEPS_HOURS) {
      const trySince = new Date(baseSince.getTime() - step * 3600_000);
      const c = await prisma.video.count({ where: buildWhere(effectiveBasis, trySince) });
      if (c > 0) {
        effectiveSince = trySince;
        effectiveHours = baseHours + step;
        break;
      }
    }
  }

  const where = buildWhere(effectiveBasis, effectiveSince);

  // =========================
  // Debug: 24h と 実効窓/基準 の両方を返す
  // =========================
  if (debug) {
    // DB/サーバ時刻
    let dbNowISO = "";
    try {
      const [row]: any = await prisma.$queryRaw`select now() as now`;
      dbNowISO = new Date(row?.now ?? Date.now()).toISOString();
    } catch {
      dbNowISO = new Date().toISOString();
    }

    // 24h 基準でのショート要素（published）
    const shortByDur24h = await prisma.video.count({
      where: {
        AND: [
          { platform: "youtube" as any, publishedAt: { gte: baseSince } },
          { AND: [{ durationSec: { gt: 0 } }, { durationSec: { lte: 60 } }] },
        ],
      },
    });
    const shortByUrl24h = await prisma.video.count({
      where: {
        AND: [
          { platform: "youtube" as any, publishedAt: { gte: baseSince } },
          { OR: [{ url: { contains: "/shorts/" } }, { platformVideoId: { contains: "/shorts/" } }] },
        ],
      },
    });
    const durNull24h = await prisma.video.count({
      where: {
        AND: [
          { platform: "youtube" as any, publishedAt: { gte: baseSince } },
          { OR: [{ durationSec: null }, { durationSec: 0 }] },
        ],
      },
    });

    const afterShortsEffective = await prisma.video.count({ where });

    // プラットフォーム分布（全体）
    let platforms: any[] = [];
    try {
      platforms = await prisma.$queryRaw<any[]>`
        select coalesce(platform,'(null)') as platform, count(*)::int as count
        from "Video" group by platform order by count desc limit 10
      `;
    } catch {}

    // DB最新
    const latest = await prisma.video.findFirst({
      orderBy: [{ publishedAt: "desc" }],
      select: {
        id: true, title: true, platform: true, publishedAt: true, durationSec: true,
        url: true, platformVideoId: true, views: true, likes: true,
      },
    });

    // 実効条件のサンプル
    const sample = await prisma.video.findMany({
      where, orderBy: [{ [effectiveBasis === "ingested" ? "createdAt" : "publishedAt"]: "desc" } as any], take: 3,
      select: { id: true, title: true, publishedAt: true, durationSec: true, url: true, platformVideoId: true, views: true, likes: true, ...(effectiveBasis === "ingested" ? { createdAt: true } : {}) } as any,
    });

    return NextResponse.json(
      {
        ok: true,
        window: { range, since: baseSince.toISOString() },
        counts24h: {
          published: count24hPublished,
          ingested: count24hIngested,
          shortByDur: shortByDur24h,
          shortByUrl: shortByUrl24h,
          durNull: durNull24h,
        },
        effectiveBasis,
        effectiveWindow: {
          since: effectiveSince.toISOString(),
          hours: effectiveHours,
          widened: effectiveHours !== baseHours,
        },
        afterShortsEffective,
        platforms,
        latest,
        sample,
        version: {
          commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
          builtAt: new Date().toISOString(),
          serverNow: new Date().toISOString(),
          dbNow: dbNowISO,
        },
      },
      { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
    );
  }

  // =========================
  // 通常レスポンス（基準と窓のフォールバック適用済み）
  // =========================
  const rows = await prisma.video.findMany({
    where,
    orderBy: [{ views: "desc" }],
    take: take * 2,
    select: {
      id: true,
      platform: true,
      platformVideoId: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      durationSec: true,
      publishedAt: true,
      // createdAt は schema にある場合は自動で返ります（必要なら select に追加）
      channelTitle: true,
      views: true,
      likes: true,
    },
  });

  const start = (page - 1) * take;
  const items = rows.slice(start, start + take);
  const total = await prisma.video.count({ where });

  return NextResponse.json(
    {
      ok: true,
      items,
      page,
      take,
      total,
      window: { range, since: baseSince.toISOString() },
      effectiveBasis,
      effectiveWindow: {
        since: effectiveSince.toISOString(),
        hours: effectiveHours,
        widened: effectiveHours !== baseHours,
      },
      params: { excludeShorts, noFallback, basis: basisParam },
      version: { commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local" },
    },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
  );
}
