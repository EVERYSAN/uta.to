// src/app/api/trending/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";   // 毎回実行
export const revalidate = 0;

const prisma = new PrismaClient();

type Range = "24h" | "7d" | "30d";
const hoursOf = (r: Range) => (r === "7d" ? 7*24 : r === "30d" ? 30*24 : 24);

export async function GET(req: Request) {
  const url = new URL(req.url);

  // パラメータ（UIが何を送っても受けられるよう、両対応）
  const range = (["24h","7d","30d"].includes(url.searchParams.get("range") || "")
    ? (url.searchParams.get("range") as Range)
    : "24h");

  // shorts=exclude でも excludeShorts=1/true でもOK
  const shortsParam = (url.searchParams.get("shorts") || "").toLowerCase();
  const excludeShorts =
    shortsParam === "exclude" ||
    /^(1|true|yes)$/i.test(url.searchParams.get("excludeShorts") || "");

  const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1);
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || "24") || 24));
  const debug = url.searchParams.has("debug"); // ← これがデバッグ切替

  const now = Date.now();
  const since = new Date(now - hoursOf(range)*3600_000);

  // ===== WHERE =====
  const baseWhere: any = {
    platform: "youtube",
    publishedAt: { gte: since },      // 厳密ローリング窓
  };

  // ショート除外（未取得のdurationSecは短尺扱いしない）
  const excludeShortsWhere = excludeShorts ? {
    NOT: {
      OR: [
        { AND: [{ durationSec: { gt: 0 } }, { durationSec: { lte: 60 } }] },
        { url: { contains: "/shorts/" } },
        { platformVideoId: { contains: "/shorts/" } },
      ],
    },
  } : {};

  const where = { AND: [baseWhere, excludeShortsWhere] };

  // ===== デバッグ用の件数 =====
  const base = await prisma.video.count({ where: baseWhere });
  const shortByDur = await prisma.video.count({
    where: { AND: [baseWhere, { AND: [{ durationSec: { gt: 0 } }, { durationSec: { lte: 60 } }] }] }
  });
  const shortByUrl = await prisma.video.count({
    where: { AND: [baseWhere, { OR: [{ url: { contains: "/shorts/" } }, { platformVideoId: { contains: "/shorts/" } }] }] }
  });
  const durNull = await prisma.video.count({ where: { AND: [baseWhere, { OR: [{ durationSec: null }, { durationSec: 0 }] }] } });
  const afterShorts = await prisma.video.count({ where });

  // ===== データ取得（views desc で多め→ページング） =====
  const rows = await prisma.video.findMany({
    where,
    orderBy: [{ views: "desc" }],
    take: take * 2,
    select: {
      id: true, platform: true, platformVideoId: true, title: true, url: true,
      thumbnailUrl: true, durationSec: true, publishedAt: true,
      channelTitle: true, views: true, likes: true,
    },
  });

  const items = rows.slice(0, take);

  if (debug) {
    // ブラウザ表示でも、Vercel Logs（requestPath:/api/trending）でも見える
    console.log("[DEBUG /api/trending]", {
      range, excludeShorts, since: since.toISOString(),
      counts: { base, shortByDur, shortByUrl, durNull, afterShorts, items: items.length }
    });
    return NextResponse.json({
      ok: true,
      window: { range, since: since.toISOString() },
      counts: { base, shortByDur, shortByUrl, durNull, afterShorts },
      sample: items.slice(0, 3),
      version: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
        builtAt: new Date().toISOString(),
      }
    }, { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } });
  }

  return NextResponse.json(
    {
      ok: true,
      items,
      page,
      take,
      total: afterShorts,
      window: { range, since: since.toISOString() },
      version: { commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local" },
    },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
  );
}
