// src/app/api/trending/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";   // 毎回サーバ実行
export const revalidate = 0;              // CDN/ISRキャッシュ無効

const prisma = new PrismaClient();

type Range = "24h" | "7d" | "30d";
const hoursOf = (r: Range) => (r === "7d" ? 7 * 24 : r === "30d" ? 30 * 24 : 24);

export async function GET(req: Request) {
  const url = new URL(req.url);

  // --- パラメータ（UIの違いに強く） ---
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

  const debug = url.searchParams.has("debug");

  // --- ローリング窓（UTC基準） ---
  const now = Date.now();
  const since = new Date(now - hoursOf(range) * 3600_000);

  // --- WHERE（ショート除外は堅牢に。未取得durationは短尺扱いしない） ---
  const baseWhere: any = {
    platform: "youtube",
    publishedAt: { gte: since },
  };

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

  // ============================
  // Debug モード： counts / sample / version を返す
  // ============================
  if (debug) {
    const base = await prisma.video.count({ where: baseWhere });
    const shortByDur = await prisma.video.count({
      where: { AND: [baseWhere, { AND: [{ durationSec: { gt: 0 } }, { durationSec: { lte: 60 } }] }] },
    });
    const shortByUrl = await prisma.video.count({
      where: { AND: [baseWhere, { OR: [{ url: { contains: "/shorts/" } }, { platformVideoId: { contains: "/shorts/" } }] }] },
    });
    const durNull = await prisma.video.count({
      where: { AND: [baseWhere, { OR: [{ durationSec: null }, { durationSec: 0 }] }] },
    });
    const afterShorts = await prisma.video.count({ where });

    // サンプル（最大3件）
    const sample = await prisma.video.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }],
      take: 3,
      select: {
        id: true, title: true, publishedAt: true, durationSec: true,
        url: true, platformVideoId: true, views: true, likes: true,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        window: { range, since: since.toISOString() },
        counts: { base, shortByDur, shortByUrl, durNull, afterShorts },
        sample,
        version: {
          commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
          builtAt: new Date().toISOString(),
        },
      },
      { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
    );
  }

  // ============================
  // 通常レスポンス（画面用。軽く views desc で返す）
  // ============================
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

  return NextResponse.json(
    {
      ok: true,
      items,
      page,
      take,
      total: await prisma.video.count({ where }),
      window: { range, since: since.toISOString() },
      version: { commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local" },
    },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
  );
}
