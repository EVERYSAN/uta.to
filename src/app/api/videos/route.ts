// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";   // APIは毎回実行
export const revalidate = 0;

const prisma = new PrismaClient();

type Range = "1d" | "7d" | "30d";
type ShortsMode = "all" | "exclude";

// 取りすぎ→JSで整列→ページング、にすることでWHEREが厳し過ぎて空になる事故を回避
const FETCH_FACTOR = 3; // 1ページぶんの3倍を取得してから絞る

export async function GET(req: Request) {
  const url = new URL(req.url);

  // ---- 1) パラメータ安全に解釈 ----
  const range = (["1d", "7d", "30d"].includes(url.searchParams.get("range") || "") 
    ? (url.searchParams.get("range") as Range)
    : "1d");

  const shorts = (["all", "exclude"].includes(url.searchParams.get("shorts") || "") 
    ? (url.searchParams.get("shorts") as ShortsMode)
    : "all");

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const take = Math.min(100, Math.max(1, parseInt(url.searchParams.get("take") || "24", 10) || 24));

  // ---- 2) 期間の算出（UTC基準のローリング窓）----
  const hours = range === "7d" ? 7 * 24 : range === "30d" ? 30 * 24 : 24;
  const now = Date.now();
  const since = new Date(now - hours * 3600_000);

  // ---- 3) WHERE 条件（ショート除外は安全側に二段）----
  const whereBase: any = {
    platform: "youtube",
    publishedAt: { gte: since },          // ローリング
  };

  // durationSec が null の古いデータでも落ちないように、「60秒超」or「shorts ではない」のOR
  const notShorts = {
    OR: [
      { durationSec: { gt: 60 } },
      { url: { not: { contains: "/shorts/" } } },
    ],
  };
  const where = shorts === "exclude" ? { AND: [whereBase, notShorts] } : whereBase;

  // ---- 4) まずは多めに取得（views降順=安定で速い）, あとで JS 側で順位付け ----
  const raw = await prisma.video.findMany({
    where,
    orderBy: [{ views: "desc" }],         // 安全・高速なソート（最終スコアは後段で再計算）
    take: take * FETCH_FACTOR,
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

  // 足りないときの保険：期間を少しだけ広げて補充（最大 +24h）
  let rows = raw;
  if (rows.length < take) {
    const sinceWider = new Date(since.getTime() - 24 * 3600_000);
    const extra = await prisma.video.findMany({
      where: { ...where, publishedAt: { gte: sinceWider } },
      orderBy: [{ views: "desc" }],
      take: take * FETCH_FACTOR,
      select: {
        id: true, platform: true, platformVideoId: true, title: true, url: true,
        thumbnailUrl: true, durationSec: true, publishedAt: true,
        channelTitle: true, views: true, likes: true,
      },
    });
    // 重複排除
    const map = new Map<string, any>();
    [...rows, ...extra].forEach(v => map.set(v.id, v));
    rows = [...map.values()];
  }

  // ---- 5) トレンドスコアを計算して安定ソート ----
  //   - 閲覧と高評価の合成
  //   - 公開直後バイアスを抑えるため時間減衰（+2h バッファ）
  //   - 数値が欠けても 0 として安全に扱う
  const withScore = rows.map((v) => {
    const views = Number(v.views || 0);
    const likes = Number(v.likes || 0);
    const published = v.publishedAt ? new Date(v.publishedAt).getTime() : now;
    const ageHours = Math.max(0, (now - published) / 3600_000);

    // 好みで調整可：likes をやや強め、時間減衰は1.3乗
    const score = (views + 4 * likes) / Math.pow(ageHours + 2, 1.3);
    return { ...v, trendingScore: score };
  });

  withScore.sort((a, b) => (b.trendingScore! - a.trendingScore!));

  // ランク付け
  withScore.forEach((v, i) => (v as any).trendingRank = i + 1);

  // ---- 6) ページング（JS側で安全に）----
  const total = withScore.length;
  const start = (page - 1) * take;
  const items = withScore.slice(start, start + take);

  // ---- 7) レスポンス（no-store）----
  return NextResponse.json(
    { ok: true, items, page, take, total },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
  );
}
