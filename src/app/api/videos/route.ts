// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * クエリ:
 *   sort   = "trending" | "new" | "support"
 *   range  = "1d" | "7d" | "30d"
 *   shorts = "all" | "exclude"
 *   page   = number (1-based)
 *   take   = number (default 24)
 *
 * レスポンス:
 *   { ok: true, items: Array<Video & { support24h: number }>, page, take }
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SortMode = "trending" | "new" | "support";
type RangeMode = "1d" | "7d" | "30d";
type ShortsMode = "all" | "exclude";

function safeInt(v: string | null, def: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function sinceFromRange(range: RangeMode | undefined): Date | null {
  const now = Date.now();
  if (!range) return null;
  const ms =
    range === "1d" ? 24 * 60 * 60 * 1000 :
    range === "7d" ? 7 * 24 * 60 * 60 * 1000 :
    range === "30d" ? 30 * 24 * 60 * 60 * 1000 : 0;
  return ms > 0 ? new Date(now - ms) : null;
}

/** Shorts 除外条件（97の思想を踏襲） */
function buildShortsWhere(mode: ShortsMode): Prisma.VideoWhereInput {
  if (mode !== "exclude") return {};
  return {
    AND: [
      { OR: [{ durationSec: null }, { durationSec: { gt: 60 } }] },
      { NOT: { url: { contains: "/shorts/" } } },
    ],
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const sort = (url.searchParams.get("sort") as SortMode) || "trending";
    const range = (url.searchParams.get("range") as RangeMode) || "1d";
    const shorts = (url.searchParams.get("shorts") as ShortsMode) || "all";
    const page = safeInt(url.searchParams.get("page"), 1);
    const take = Math.min(safeInt(url.searchParams.get("take"), 24), 100);
    const skip = (page - 1) * take;

    // 期間フィルタ
    const since = sinceFromRange(range);

    // 97と同様の基本フィルタ
    const baseWhere: Prisma.VideoWhereInput = {
      platform: "youtube",
      ...(since ? { publishedAt: { gte: since } } : {}),
      ...buildShortsWhere(shorts),
    };

    // DBソート（supportは後段で並べ替え）
    let orderBy: Prisma.VideoOrderByWithRelationInput = { views: "desc" };
    if (sort === "new") orderBy = { publishedAt: "desc" };

    // 動画取得
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

    // 期間内の応援数を集計
    const ids = videos.map(v => v.id);
    let supportMap = new Map<string, number>();
    if (ids.length > 0) {
      const grouped = await prisma.supportEvent.groupBy({
        by: ["videoId"],
        where: {
          videoId: { in: ids },
          ...(since ? { createdAt: { gte: since } } : {}),
        },
        _count: { _all: true },
      });
      supportMap = new Map(grouped.map(g => [g.videoId, g._count._all]));
    }

    // 応援数を合成
    let items = videos.map(v => ({
      ...v,
      support24h: supportMap.get(v.id) ?? 0, // rangeに応じた期間集計
      support: supportMap.get(v.id) ?? 0,    // 互換用（必要なら）
    }));

    if (sort === "support") {
      items.sort((a, b) => (b.support24h ?? 0) - (a.support24h ?? 0));
    }

    return NextResponse.json(
      { ok: true, items, page, take },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("/api/videos GET failed", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
