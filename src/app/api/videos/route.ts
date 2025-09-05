// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // 生成キャッシュ無効

type Sort = "trending" | "support" | "new"; // "trending"=既定, "support"=応援順, "new"=新着

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip = (page - 1) * take;

  const range = (sp.get("range") ?? "1d").toLowerCase() as "1d" | "7d" | "30d";
  const sort  = (sp.get("sort")  ?? "trending").toLowerCase() as Sort;
  const shorts = (sp.get("shorts") ?? "all").toLowerCase() as "all" | "exclude" | "only";

  const since = sinceFromRange(range);

  // 動画側の基本フィルタ（97の挙動を踏襲）
  const videoBaseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    publishedAt: { gte: since },
    ...buildShortsWhere(shorts),
  };

  // 応援ポイントは「SupportEvent（期間内）」の _count 集計で出す
  // Schema に points カラムがある場合に備えるなら _sum へ切替も可能だが、
  // ここは安定の _count で統一
  if (sort === "support") {
    // 期間内の応援が多い videoId を上位から取得（全体からランキング）
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        createdAt: { gte: since },
        // 関連 Video の条件（プラットフォーム/ショート/期間）を同時に適用
        video: { is: videoBaseWhere },
      },
      _count: { _all: true },
    });

    // Prisma では orderBy(_count._all) が型エラーになるため、メモリで降順ソート
    grouped.sort((a, b) => (b._count._all - a._count._all));

    // ページング
    const pageSlice = grouped.slice(skip, skip + take);
    const ids = pageSlice.map(g => g.videoId);

    // 詳細を取得
    const videos = await prisma.video.findMany({
      where: { id: { in: ids } },
      select: selectVideoFields,
    });
    const videoMap = new Map(videos.map(v => [v.id, v]));

    // 元の順位を保ったまま整形（supportRank も付与）
    const items = pageSlice
      .map((g, i) => {
        const v = videoMap.get(g.videoId);
        if (!v) return null;
        return {
          ...v,
          supportPoints: g._count._all,
          supportRank: skip + i + 1,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    return NextResponse.json(
      { ok: true, items, page, take },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ← ここからは「急上昇」「新着」など通常のリスト
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
  if (sort === "new") orderBy = { publishedAt: "desc" };

  const videos = await prisma.video.findMany({
    where: videoBaseWhere,
    orderBy,
    skip,
    take,
    select: selectVideoFields,
  });

  // 表示中の動画に対してだけ期間内の応援件数を付与
  const ids = videos.map(v => v.id);
  let supportMap = new Map<string, number>();
  if (ids.length) {
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { videoId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    supportMap = new Map(grouped.map(g => [g.videoId, g._count._all]));
  }

  const items = videos.map(v => ({
    ...v,
    supportPoints: supportMap.get(v.id) ?? 0,
  }));

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/* ===== helpers ===== */
const selectVideoFields = {
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
} satisfies Prisma.VideoSelect;

function sinceFromRange(range: "1d" | "7d" | "30d"): Date {
  const now = Date.now();
  const ms = range === "1d" ? 24*60*60*1000 : range === "7d" ? 7*24*60*60*1000 : 30*24*60*60*1000;
  return new Date(now - ms);
}

function buildShortsWhere(shorts: "all" | "exclude" | "only"): Prisma.VideoWhereInput | {} {
  if (shorts === "exclude") return { NOT: { url: { contains: "/shorts/" } } };
  if (shorts === "only")    return { url: { contains: "/shorts/" } };
  return {};
}
