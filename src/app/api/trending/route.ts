// src/app/api/trending/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const prisma = new PrismaClient();

type Range = "24h" | "7d" | "30d";
const hoursOf = (r: Range) => (r === "7d" ? 7 * 24 : r === "30d" ? 30 * 24 : 24);

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

  // --- rolling window (UTC) ---
  const now = Date.now();
  const since = new Date(now - hoursOf(range) * 3600_000);

  // --- filters ---
  const baseWhere: any = {
    platform: "youtube",
    publishedAt: { gte: since },
  };

  // 未取得の durationSec は短尺扱いしない
  const excludeShortsWhere = excludeShorts
    ? {
        NOT: {
          OR: [
            { AND: [{ durationSec: { gt: 0 } }, { durationSec: { lte: 60 } }] },
            { url: { contains: "/shorts/" } },
            { platformVideoId: { contains: "/shorts/" } },
          ],
        },
      }
    : {};

  const where = { AND: [baseWhere, excludeShortsWhere] };

  // =========================
  // Debug: counts / sample / version
  // =========================
  if (debug) {
    // 1) DB時刻とサーバ時刻
    let dbNowISO = "";
    try {
      const [row]: any = await prisma.$queryRaw`select now() as now`;
      dbNowISO = new Date(row?.now ?? Date.now()).toISOString();
    } catch {
      dbNowISO = new Date().toISOString();
    }

    // 2) 直近件数（全PF / YouTube系）
    const baseAllPlatforms = await prisma.video.count({
      where: { publishedAt: { gte: since } },
    });

    let baseYouTubeInsensitive = 0;
    try {
      baseYouTubeInsensitive = await prisma.video.count({
        where: {
          publishedAt: { gte: since },
          platform: { in: ["youtube", "YouTube", "YOUTUBE"] as any },
        },
      });
    } catch {
      // enum 等で in が使えない場合のフォールバック
      baseYouTubeInsensitive = await prisma.video.count({
        where: { publishedAt: { gte: since }, platform: "youtube" as any },
      });
    }

    // 3) ショート判定の各要素
    const shortByDur = await prisma.video.count({
      where: {
        AND: [
          { publishedAt: { gte: since } },
          { AND: [{ durationSec: { gt: 0 } }, { durationSec: { lte: 60 } }] },
        ],
      },
    });
    const shortByUrl = await prisma.video.count({
      where: {
        AND: [
          { publishedAt: { gte: since } },
          {
            OR: [
              { url: { contains: "/shorts/" } },
              { platformVideoId: { contains: "/shorts/" } },
            ],
          },
        ],
      },
    });
    const durNull = await prisma.video.count({
      where: {
        AND: [
          { publishedAt: { gte: since } },
          { OR: [{ durationSec: null }, { durationSec: 0 }] },
        ],
      },
    });

    // 4) 実際の where での件数
    const afterShorts = await prisma.video.count({ where });

    // 5) プラットフォーム分布
    let platforms: any[] = [];
    try {
      platforms = await prisma.$queryRaw<any[]>`
        select coalesce(platform,'(null)') as platform, count(*)::int as count
        from "Video" group by platform order by count desc limit 10
      `;
    } catch {
      /* ignore */
    }

    // 6) DBの最新1件
    const latest = await prisma.video.findFirst({
      orderBy: [{ publishedAt: "desc" }],
      select: {
        id: true,
        title: true,
        platform: true,
        publishedAt: true,
        durationSec: true,
        url: true,
        platformVideoId: true,
        views: true,
        likes: true,
      },
    });

    // 7) 現在の条件でのサンプル
    const sample = await prisma.video.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }],
      take: 3,
      select: {
        id: true,
        title: true,
        publishedAt: true,
        durationSec: true,
        url: true,
        platformVideoId: true,
        views: true,
        likes: true,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        window: { range, since: since.toISOString() },
        counts: {
          baseAllPlatforms,
          baseYouTubeInsensitive,
          shortByDur,
          shortByUrl,
          durNull,
          afterShorts,
        },
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
  // normal response (for page)
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
      window: { range, since: since.toISOString() },
      version: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
      },
    },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
  );
}
