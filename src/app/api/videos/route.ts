// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// 念のため API レベルでもキャッシュ無効化
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** range クエリを Date にする（UTC） */
function sinceFromRange(range: string | null): Date | undefined {
  const now = Date.now();
  switch (range) {
    case "1d":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    default:
      return undefined; // 全期間
  }
}

/** shorts=exclude のときの where を返す（readonly を作らない） */
function buildShortsWhere(shorts: string | null): Prisma.VideoWhereInput {
  if (shorts === "exclude") {
    return {
      AND: [
        { OR: [{ durationSec: null }, { durationSec: { gt: 60 } }] },
        { NOT: { url: { contains: "/shorts/" } } },
      ],
    };
  }
  return {};
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const sort = (sp.get("sort") ?? "trending") as "trending" | "new";
  const range = (sp.get("range") ?? "1d") as "1d" | "7d" | "30d" | "all";
  const shorts = (sp.get("shorts") ?? "all") as "all" | "exclude";

  const page = Math.max(1, Number(sp.get("page") ?? "1"));
  const take = Math.min(50, Math.max(1, Number(sp.get("take") ?? "24")));
  const skip = (page - 1) * take;

  // 期間フィルタ（常に適用）
  const since = sinceFromRange(range);

  // 基本 where（プラットフォーム固定 + 公開日範囲 + ショート条件）
  const baseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // 並び替え（DB 側）
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
  if (sort === "new") {
    orderBy = { publishedAt: "desc" };
  }

  // 動画を取得
  const videos = await prisma.video.findMany({
    where: baseWhere,
    orderBy, // 型崩れを避けるため Prisma の型で固定
    skip,
    take,
    select: {
      id: true,
      platform: true,
      platformVideoId: true,
      title: true,
      channelTitle: true,
      url: true,
      thumbnailUrl: true,
      durationSec: true,
      publishedAt: true,
      views: true,
      likes: true,
    },
  });

  // ▼ ここから追加：期間内の応援ポイントを集計して videos に合成する
  // 期間境界
// ▼ ここから貼り替え（findMany のすぐ後）
const now = Date.now();
const ms =
  range === "1d" ? 24 * 60 * 60 * 1000 :
  range === "7d" ? 7 * 24 * 60 * 60 * 1000 :
  30 * 24 * 60 * 60 * 1000;
const since = new Date(now - ms);

// 期間内の応援ポイントを videoId ごとに集計
const ids = videos.map(v => v.id);
let supportMap = new Map<string, number>();

if (ids.length > 0) {
  const grouped = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: {
      videoId: { in: ids },
      createdAt: { gte: since },
    },
    _sum: { points: true },
  });
  supportMap = new Map(grouped.map(g => [g.videoId, g._sum.points ?? 0]));
}

// 応援ポイントを付与
let items = videos.map(v => ({
  ...v,
  supportPoints: supportMap.get(v.id) ?? 0,
}));

// 並び「応援」のときは応援ポイントでソート（97のフィルタはそのまま）
if (sort === "support") {
  items.sort((a, b) => (b.supportPoints ?? 0) - (a.supportPoints ?? 0));
}

return NextResponse.json(
  { ok: true, items, page, take },
  { headers: { "Cache-Control": "no-store" } }
);

  // 24h 応援ポイントをまとめて集計 → マージ
  const ids = videos.map((v) => v.id);
  let supportMap = new Map<string, number>();
  if (ids.length > 0) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: ids },
        createdAt: { gte: since24h },
      },
      _count: { _all: true },
    });
    supportMap = new Map(grouped.map((g) => [g.videoId, g._count._all]));
  }

  const items = videos.map((v) => {
    const s = supportMap.get(v.id) ?? 0;
    return {
      ...v,
      support24h: s,
      // 互換用の別名（フロントが何を読んでいても表示できるように）
      support: s,
      pt: s,
    };
  });

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
