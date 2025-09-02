// src/app/api/trending/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const prisma = new PrismaClient();

type Range = "24h" | "7d" | "30d";
const hoursOf = (r: Range) => (r === "7d" ? 7 * 24 : r === "30d" ? 30 * 24 : 24);

// 補完の上限（空を避けるため最大72hまで広げる）
const FALLBACK_STEPS_HOURS = [0, 24, 48]; // 0=そのまま, 次に+24h(=48h窓), 次に+48h(=72h窓)

export async function GET(req: Request) {
  const url = new URL(req.url);

  // --- params ---
  const rangeParam = (url.searchParams.get("range") || "").toLowerCase();
  const range: Range = (["24h", "7d", "30d"] as const).includes(rangeParam as any)
    ? (rangeParam as Range)
    : "24h";

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

  // --- WHERE ビルダー（sinceと除外条件を注入） ---
  const buildWhere = (since: Date) => {
    const baseWhere: any = {
      platform: "youtube",
      publishedAt: { gte: since },
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

  // --- 24h 基準の件数（診断用に必ず計測） ---
  const counts24h = {
    baseAllPlatforms: await prisma.video.count({ where: { publishedAt: { gte: baseSince } } }),
    baseYouTube: await prisma.video.count({ where: { publishedAt: { gte: baseSince }, platform: "youtube" as any } }),
  };

  // --- フォールバック窓の決定（noFallback のときは 24h 固定）---
  let effectiveSince = baseSince;
  let effectiveHours = baseHours;

  if (!noFallback) {
    for (const step of FALLBACK_STEPS_HOURS) {
      const trySince = new Date(baseSince.getTime() - step * 3600_000);
      const c = await prisma.video.count({ where: buildWhere(trySince) });
      if (c > 0) {
        effectiveSince = trySince;
        effectiveHours = baseHours + step;
        break;
      }
    }
  }

  const where = buildWhere(effectiveSince);

  // =========================
  // Debug: 24h と 実効窓 の両方を返す
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

    // ショート要素（24h基準で）
    const shortByDur24h = await prisma.video.count({
      where: {
        AND: [
          { publishedAt: { gte: baseSince } },
          { AND: [{ durationSec: { gt: 0 } }, { durationSec: { lte: 60 } }] },
        ],
      },
    });
    const shortByUrl24h = await prisma.video.count({
      where: {
        AND: [
          { publishedAt: { gte: baseSince } },
          { OR: [{ url: { contains: "/shorts/" } }, { platformVideoId: { contains: "/shorts/" } }] },
        ],
      },
    });
    const durNull24h = await prisma.video.count({
      where: {
        AND: [{ publishedAt: { gte: baseSince } }, { OR: [{ durationSec: null }, { durationSec: 0 }] }],
      },
    });

    // 実効 where での件数
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
      where, orderBy: [{ publishedAt: "desc" }], take: 3,
      select: { id: true, title: true, publishedAt: true, durationSec: true, url: true, platformVideoId: true, views: true, likes: true },
    });

    return NextResponse.json(
      {
        ok: true,
        window: { range, since: baseSince.toISOString() },
        counts24h: {
          ...counts24h,
          shortByDur: shortByDur24h,
          shortByUrl: shortByUrl24h,
          durNull: durNull24h,
        },
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
  // 通常レスポンス（空を避けるフォールバック適用済み）
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
      effectiveWindow: {
        since: effectiveSince.toISOString(),
        hours: effectiveHours,
        widened: effectiveHours !== baseHours,
      },
      params: { excludeShorts, noFallback },
      version: { commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local" },
    },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
  );
}
