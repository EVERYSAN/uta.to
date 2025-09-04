// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // 生成キャッシュを無効化

// range=1d|7d|30d, sort=hot|new|support, shorts=all|exclude|only
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const page  = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take  = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip  = (page - 1) * take;

  const range  = (sp.get("range")  ?? "1d").toLowerCase();
  const sort   = (sp.get("sort")   ?? "hot").toLowerCase();
  const shorts = (sp.get("shorts") ?? "all").toLowerCase();

  // 期間境界（期間内集計にだけ使う）
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

  const ids = videos.map(v => v.id);

  // -------- 追加：累計（createdAt フィルタ無し） --------
  let totalMap = new Map<string, number>();
  if (ids.length > 0) {
    const total = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { videoId: { in: ids } },
      _count: { _all: true },
    });
    totalMap = new Map(total.map(g => [g.videoId, g._count._all]));
  }

  // 期間内（これまで通り）
  let rangeMap = new Map<string, number>();
  if (ids.length > 0) {
    const ranged = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { videoId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    rangeMap = new Map(ranged.map(g => [g.videoId, g._count._all]));
  }

  // API レスポンス：期間内 + 累計 を両方載せる
  let items = videos.map(v => ({
    ...v,
    supportPoints: rangeMap.get(v.id) ?? 0,  // 期間内（後方互換）
    supportTotal:  totalMap.get(v.id) ?? 0,  // 累計（新規）
  }));

  // -------- 上書き：応援順は累計でソート --------
  if (sort === "support") {
    items.sort((a, b) => (b.supportTotal ?? 0) - (a.supportTotal ?? 0));
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
    range === "1d" ? 24 * 60 * 60 * 1000 :
    range === "7d" ? 7  * 24 * 60 * 60 * 1000 :
                     30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms);
}

function buildShortsWhere(shorts: string | null): Prisma.VideoWhereInput | {} {
  if (shorts === "exclude") return { NOT: { url: { contains: "/shorts/" } } };
  if (shorts === "only")    return {       url: { contains: "/shorts/" } };
  return {};
}
