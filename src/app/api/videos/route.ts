import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma"; // prisma の re-export を使っている前提
import { Prisma } from "@prisma/client";

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
    // ① durationSec が null（取得不能）か 60 秒超
    // ② URL に /shorts/ を含まない
    return {
      AND: [
        { OR: [{ durationSec: null }, { durationSec: { gt: 60 } }] },
        { NOT: { url: { contains: "/shorts/" } } },
      ],
    };
  }
  return {}; // すべて含める
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams;

  const range = (search.get("range") as Range) || "1d";
  const shorts = (search.get("shorts") as ShortsMode) || "all";
  const sort = (search.get("sort") as SortMode) || "trending";
  const page = Math.max(1, parseInt(search.get("page") ?? "1", 10));
  const take = Math.min(100, Math.max(1, parseInt(search.get("take") ?? "24", 10)));
  const skip = (page - 1) * take;

  // 期間境界（常に適用）
  const since = sinceFromRange(range);

  // 97 と同じフィルタ（YouTube 固定 + 公開日時範囲 + shorts 条件）
  const baseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // DB ソート（support の場合は後でメモリ上で並べ替える）
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
  if (sort === "new") orderBy = { publishedAt: "desc" };

  // 動画一覧
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

  // 期間内の応援ポイントを videoId ごとに集計（SupportEvent）
  const ids = videos.map(v => v.id);
  let supportMap = new Map<string, number>();
  if (ids.length > 0) {
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: ids },
        createdAt: { gte: since },     // ← 選択した 1d/7d/30d に合わせて集計
      },
      _sum: { points: true },          // points を加算（+1 応援なら 1 が入る想定）
    });
    supportMap = new Map(grouped.map(g => [g.videoId, g._sum.points ?? 0]));
  }

  // 応援ポイントを合成（カード側が読むフィールド名を `support24h` としておく）
  let items = videos.map(v => ({
    ...v,
    support24h: supportMap.get(v.id) ?? 0,
  }));

  // 並び替え「応援」のときは support24h でメモリソート
  if (sort === "support") {
    items.sort((a, b) => (b.support24h ?? 0) - (a.support24h ?? 0));
  }

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}
