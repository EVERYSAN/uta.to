import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const prisma = new PrismaClient();

type Range = "1d" | "7d" | "30d";
type ShortsMode = "all" | "exclude";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const range = (["1d", "7d", "30d"].includes(url.searchParams.get("range") || "")
    ? (url.searchParams.get("range") as Range)
    : "1d");

  const shorts = (["all", "exclude"].includes(url.searchParams.get("shorts") || "")
    ? (url.searchParams.get("shorts") as ShortsMode)
    : "all");

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const take = Math.min(100, Math.max(1, parseInt(url.searchParams.get("take") || "24", 10) || 24));

  // ---- 厳密なローリング窓（UTC基準）----
  const hours = range === "7d" ? 7 * 24 : range === "30d" ? 30 * 24 : 24;
  const now = Date.now();
  const since = new Date(now - hours * 3600_000);

  // ---- WHERE ----
  const baseWhere: any = {
    platform: "youtube",
    publishedAt: { gte: since },         // ← ここだけで厳密に絞る（拡張窓は撤廃）
  };

  // ショート除外: NOT( durationSec <= 60 OR url contains '/shorts/' OR platformVideoId contains '/shorts/' )
  const excludeShortsWhere =
    shorts === "exclude"
      ? {
          NOT: {
            OR: [
              { durationSec: { lte: 60 } },
              { url: { contains: "/shorts/" } },
              { platformVideoId: { contains: "/shorts/" } },
            ],
          },
        }
      : {};

  const where = { AND: [baseWhere, excludeShortsWhere] };

  // ---- 取得（まずは多めに取らず、厳密窓の中だけで取る）----
  // 並びはシンプルに views desc → その後にスコアで安定化
  const rows = await prisma.video.findMany({
    where,
    orderBy: [{ views: "desc" }],
    take: take * 2, // 少し多めに（同率の並びが不安定なとき用）
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

  // ---- トレンドスコア（軽め）----
  const withScore = rows.map((v) => {
    const views = Number(v.views || 0);
    const likes = Number(v.likes || 0);
    const published = v.publishedAt ? new Date(v.publishedAt).getTime() : now;
    const ageH = Math.max(0, (now - published) / 3600_000);
    const score = (views + 4 * likes) / Math.pow(ageH + 2, 1.3);
    return { ...v, trendingScore: score };
  });

  withScore.sort((a, b) => (b.trendingScore! - a.trendingScore!));

  // ---- ページング ----
  const start = (page - 1) * take;
  const items = withScore.slice(start, start + take);

  return NextResponse.json(
    {
      ok: true,
      items,
      page,
      take,
      total: withScore.length,
      window: { range, since: since.toISOString() }, // デバッグ用に返すと確認が楽
    },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
  );
}
