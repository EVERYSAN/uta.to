// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic"; // 生成キャッシュを無効化

// range=1d|7d|30d, sort=hot|new|support, shorts=all|exclude|only
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const page   = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take   = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "24", 10)));
  const skip   = (page - 1) * take;
  const range  = (sp.get("range")  ?? "1d").toLowerCase();
  const sort   = (sp.get("sort")   ?? "hot").toLowerCase();
  const shorts = (sp.get("shorts") ?? "all").toLowerCase();

  const since = sinceFromRange(range);

  // 動画側のベース条件（97と同じ：プラットフォーム＋公開日範囲＋ショート条件）
  const videoBaseWhere: Prisma.VideoWhereInput = {
    platform: "youtube",
    ...(since ? { publishedAt: { gte: since } } : {}),
    ...buildShortsWhere(shorts),
  };

  // --- 応援順（support）：SupportEvent を起点に上位を出す ---
  if (sort === "support") {
    // 期間内の応援を videoId ごとに集計（並びはJSでやる）
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: {
        createdAt: { gte: since },
        // 動画の絞り込み（公開日/ショート条件など）も効かせる
        video: { is: videoBaseWhere },
      },
      _count: { _all: true },
    });

    // 応援がないものは自然と除外（OKな仕様）
    grouped.sort((a, b) => (b._count._all ?? 0) - (a._count._all ?? 0));

    // ページネーション
    const pageIds = grouped.slice(skip, skip + take).map(g => g.videoId);
    const countMap = new Map(grouped.map(g => [g.videoId, g._count._all ?? 0]));

    if (pageIds.length === 0) {
      return NextResponse.json(
        { ok: true, items: [], page, take },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 実体の動画を取得（IN だと順序が崩れるので後で整列）
    const videos = await prisma.video.findMany({
      where: { id: { in: pageIds } },
      select: baseSelect,
    });

    const byId = new Map(videos.map(v => [v.id, v]));
    const items = pageIds
      .map(id => byId.get(id))
      .filter((v): v is typeof videos[number] => Boolean(v))
      .map(v => ({ ...v, supportPoints: countMap.get(v.id) ?? 0 }));

    return NextResponse.json(
      { ok: true, items, page, take },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // --- hot/new：通常の動画取得 + 表示分だけ応援件数を合成（0も含む） ---
  let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
  if (sort === "new") orderBy = { publishedAt: "desc" };

  const videos = await prisma.video.findMany({
    where: videoBaseWhere,
    orderBy,
    skip,
    take,
    select: baseSelect,
  });

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
    supportMap = new Map(grouped.map(g => [g.videoId, g._count._all ?? 0]));
  }

  const items = videos.map(v => ({
    ...v,
    supportPoints: supportMap.get(v.id) ?? 0, // ← 常に付ける（カードがこれを読む）
  }));

  return NextResponse.json(
    { ok: true, items, page, take },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/* ---------- helpers ---------- */

const baseSelect = {
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
  if (shorts === "only")    return {      url: { contains: "/shorts/" } };
  return {};
}
