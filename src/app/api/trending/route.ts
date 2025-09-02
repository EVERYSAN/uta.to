// src/app/api/trending/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";   // 毎回サーバで実行
export const revalidate = 0;              // CDN/ISR キャッシュ無効

const prisma = new PrismaClient();

type Range = "24h" | "7d" | "30d";
type Shorts = "all" | "exclude";
type Sort = "trending" | "views" | "likes";

const hoursOf = (r: Range) => (r === "7d" ? 7 * 24 : r === "30d" ? 30 * 24 : 24);

export async function GET(req: Request) {
  const url = new URL(req.url);

  // ---- パラメータ（安全に既定値にフォールバック）----
  const range = (["24h", "7d", "30d"].includes(url.searchParams.get("range") || "")
    ? (url.searchParams.get("range") as Range)
    : "24h");

  const shorts = (["all", "exclude"].includes(url.searchParams.get("shorts") || "")
    ? (url.searchParams.get("shorts") as Shorts)
    : "all");

  const sort = (["trending", "views", "likes"].includes(url.searchParams.get("sort") || "")
    ? (url.searchParams.get("sort") as Sort)
    : "trending");

  const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1);
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || "24") || 24));

  // ---- 厳密ローリング窓（UTC基準・拡張窓は使わない）----
  const now = Date.now();
  const since = new Date(now - hoursOf(range) * 3600_000);

  // ---- WHERE（ショート除外は NOT(…OR…) で厳密に）----
  const baseWhere: any = {
    platform: "youtube",
    publishedAt: { gte: since },
  };

  const excludeShorts =
    shorts === "exclude"
      ? {
          NOT: {
            OR: [
              { durationSec: { lte: 60 } },               // 60秒以下
              { url: { contains: "/shorts/" } },          // URLにshorts
              { platformVideoId: { contains: "/shorts/" } },
            ],
          },
        }
      : {};

  const where = { AND: [baseWhere, excludeShorts] };

  // ---- 取得（まずは views 降順で多めに。あとで安定化）----
  const rows = await prisma.video.findMany({
    where,
    orderBy: [{ views: "desc" }],
    take: take * 2, // 同率ソートの揺れ用に少し多め
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

  // ---- トレンドスコア計算（公開直後バイアスを抑える軽量式）----
  const scored = rows.map((v) => {
    const views = Number(v.views || 0);
    const likes = Number(v.likes || 0);
    const published = v.publishedAt ? new Date(v.publishedAt).getTime() : now;
    const ageHours = Math.max(0, (now - published) / 3600_000);
    const trendingScore = (views + 4 * likes) / Math.pow(ageHours + 2, 1.3);
    return { ...v, trendingScore };
  });

  // ---- 並び替え ----
  if (sort === "views") {
    scored.sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
  } else if (sort === "likes") {
    scored.sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0));
  } else {
    scored.sort((a, b) => (b.trendingScore! - a.trendingScore!));
  }
  scored.forEach((v, i) => ((v as any).trendingRank = i + 1));

  // ---- ページング ----
  const start = (page - 1) * take;
  const items = scored.slice(start, start + take);

  // ---- レスポンス（no-store）----
  return NextResponse.json(
    {
      ok: true,
      items,
      page,
      take,
      total: scored.length,
      window: { range, since: since.toISOString() }, // デバッグ確認に便利
    },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
  );
}
