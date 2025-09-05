// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // 生成キャッシュを無効化

// クエリ: range=1d|7d|30d, sort=trending|support, shorts=all|exclude
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const page   = Math.max(1, parseInt(sp.get("page")  ?? "1", 10));
  const take   = Math.min(100, Math.max(1, parseInt(sp.get("take")  ?? "24", 10)));
  const skip   = (page - 1) * take;

  const range  = (sp.get("range")  ?? "1d").toLowerCase() as "1d" | "7d" | "30d";
  const sort   = (sp.get("sort")   ?? "trending").toLowerCase() as "trending" | "support";
  const shorts = (sp.get("shorts") ?? "all").toLowerCase() as "all" | "exclude";

  // 期間境界
  const since = sinceFromRange(range);

  // 基本フィルタ（97と同等：プラットフォーム固定＋期間＋ショート条件）
  const where: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // DB側の並び（「応援」は後でメモリソート）
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
  // 並びに "new" を使う場合はここで切替
  // if (sort === "new") orderBy = { publishedAt: "desc" };

  // 対象動画の取得
  const videos = await prisma.video.findMany({
    where,
    orderBy,
    skip,
    take,
    select: {
      id: true,
      platform: true,        // Prisma では string
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

  // 期間内の応援を videoId ごとに集計（SupportEvent を _count）
  const ids = videos.map(v => v.id);
  let supportMap = new Map<string, number>();

  if (ids.length > 0) {
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: ids },
        createdAt: { gte: since },
      },
      _count: { _all: true }, // 件数をカウント
    });
    supportMap = new Map(grouped.map(g => [g.videoId, g._count?._all ?? 0]));
  }

  // 応援件数を合成（※型注釈は付けずに推論に任せる）
  let items = videos.map(v => ({
    ...v,
    supportPoints: supportMap.get(v.id) ?? 0,
  }));

  // 応援順ソート時はメモリで並べ替え＆順位を振る
  if (sort === "support") {
    items.sort((a, b) => (b.supportPoints ?? 0) - (a.supportPoints ?? 0));
    items = items.map((v, i) => ({ ...v, supportRank: skip + i + 1 }));
  }

  // キャッシュ無効化ヘッダ
  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/* ===== helpers ===== */

function sinceFromRange(range: "1d" | "7d" | "30d"): Date {
  const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function buildShortsWhere(shorts: "all" | "exclude"): Prisma.VideoWhereInput {
  // 「ショート除外」= URL に /shorts/ を含むものを除外
  if (shorts === "exclude") return { NOT: { url: { contains: "/shorts/" } } };
  return {};
}
