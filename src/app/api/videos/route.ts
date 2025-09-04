import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type Range = "1d" | "7d" | "30d";
type ShortsMode = "all" | "exclude";
type SortMode = "trending" | "new" | "support";

function sinceFromRange(range: Range): Date {
  const ms =
    range === "1d" ? 24 * 60 * 60 * 1000 :
    range === "7d" ? 7 * 24 * 60 * 60 * 1000 :
    30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

function buildShortsWhere(mode: ShortsMode): Prisma.VideoWhereInput {
  if (mode === "exclude") {
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
  const url = new URL(req.url);
  const sp = url.searchParams;

  const range = (sp.get("range") as Range) || "1d";
  const shorts = (sp.get("shorts") as ShortsMode) || "all";
  const sort = (sp.get("sort") as SortMode) || "trending";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip = (page - 1) * take;

  const since = sinceFromRange(range);

  // 97と同じ基本フィルタ
  const baseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // DB側の orderBy（support は後でメモリソート）
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
  if (sort === "new") orderBy = { publishedAt: "desc" };

  const videos = await prisma.video.findMany({
    where: baseWhere,
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

    // ここから追加：選択レンジの開始時刻
  const now = Date.now();
  const ms =
    range === "1d" ? 24 * 60 * 60 * 1000 :
    range === "7d" ? 7  * 24 * 60 * 60 * 1000 :
                     30 * 24 * 60 * 60 * 1000;
  const since = new Date(now - ms);
  
  // 表示中の動画だけを対象に、期間内の応援件数を videoId ごとに集計
  const ids = videos.map(v => v.id);
  let supportMap = new Map<string, number>();
  
  if (ids.length > 0) {
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: ids },
        createdAt: { gte: since },
      },
      _count: { _all: true }, // ← 件数で集計（points カラムは無い想定）
    });
    supportMap = new Map(grouped.map(g => [g.videoId, g._count._all]));
  }
  
  // 応援件数を合成（API で常に返す）
  let items = videos.map(v => ({
    ...v,
    supportPoints: supportMap.get(v.id) ?? 0,
  }));
  
  // 並びが「応援」のときだけ、応援件数で並べ替え（既存のフィルタ/whereはそのまま）
  if (sort === "support") {
    items.sort((a, b) => (b.supportPoints ?? 0) - (a.supportPoints ?? 0));
  }
  
  // 可能なら no-store を明示（fetch 側でも no-store を付けているのでダブルで効かせる）
  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );

  // 期間内の応援（SupportEvent）を videoId ごとに _count 集計
  const ids = videos.map(v => v.id);
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
    supportMap = new Map(grouped.map(g => [g.videoId, g._count._all]));
  }

  // API レスポンスへ合成（カードが読むキーを `support24h` に統一）
  let items = videos.map(v => ({
    ...v,
    support24h: supportMap.get(v.id) ?? 0,
  }));

  if (sort === "support") {
    items.sort((a, b) => (b.support24h ?? 0) - (a.support24h ?? 0));
  }

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}
