// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // 生成キャッシュを無効化

// range=1d|7d|30d, sort=hot|new|support, shorts=all|exclude|only
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip = (page - 1) * take;

  const range = (sp.get("range") ?? "1d").toLowerCase();
  const sort = (sp.get("sort") ?? "hot").toLowerCase();
  const shorts = (sp.get("shorts") ?? "all").toLowerCase();

  // 期間境界
  const since = sinceFromRange(range);

  // 97と同じ基本フィルタ（プラットフォーム固定＋期間＋ショート条件）
  const where: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // DB側の並び（「応援」は後でメモリソート）
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
  if (sort === "new") orderBy = { publishedAt: "desc" };

  // 対象動画の取得
  const videos = await prisma.video.findMany({
    where,
    orderBy,
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

  // 期間内の応援件数を videoId ごとに集計（SupportEvent を _count）
  const ids = videos.map((v) => v.id);
  let supportMap = new Map<string, number>();

  if (ids.length > 0) {
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: ids },
        createdAt: { gte: since },
      },
      _count: { _all: true },
    });
    supportMap = new Map(grouped.map((g) => [g.videoId, g._count._all]));
  }

  // 応援件数を合成
  const items = videos.map((v) => ({
    ...v,
    supportPoints: supportMap.get(v.id) ?? 0, // ← これをカードで表示
  }));

  // 並びが「応援」のときは応援件数でメモリソート
  if (sort === "support") {
    items.sort((a, b) => (b.supportPoints ?? 0) - (a.supportPoints ?? 0));
  }

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// ----- helpers -----

function sinceFromRange(range: string | null): Date {
  const now = Date.now();
  const ms =
    range === "1d"
      ? 24 * 60 * 60 * 1000
      : range === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms);
}

function buildShortsWhere(
  shorts: string | null
): Prisma.VideoWhereInput | {} {
  // 97の挙動：「ショート除外」＝ shorts=exclude → URLに /shorts/ を含むものを除外
  if (shorts === "exclude") {
    return { NOT: { url: { contains: "/shorts/" } } };
  }
  if (shorts === "only") {
    return { url: { contains: "/shorts/" } };
  }
  return {};
}
