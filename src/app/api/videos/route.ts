// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type Range = "1d" | "7d" | "30d";
type ShortsMode = "all" | "exclude";
type SortMode = "trending" | "views" | "recent";

/** 日数→ms */
const msOfDays = (d: number) => d * 24 * 60 * 60 * 1000;
/** range→起点日時 */
function sinceFromRange(range: Range) {
  const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
  return new Date(Date.now() - msOfDays(days));
}

/** shorts モードの除外条件（readonly 配列にならないよう素直に書く） */
function buildShortsFilter(mode: ShortsMode): Prisma.VideoWhereInput {
  if (mode !== "exclude") return {};
  return {
    AND: [
      {
        // 60秒以下をショートとみなして除外（duration 不明は通す）
        OR: [{ durationSec: null }, { durationSec: { gt: 60 } }],
      },
      // URL 由来の shorts も除外
      { NOT: { url: { contains: "/shorts/" } } },
    ],
  };
}

/** 並び順 */
function buildOrder(sort: SortMode): Prisma.VideoOrderByWithRelationInput[] {
  if (sort === "views") return [{ views: "desc" }];
  if (sort === "recent") return [{ publishedAt: "desc" }];
  // trending はまずは新しい順（必要ならスコア実装に差し替え）
  return [{ publishedAt: "desc" }];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const range = (url.searchParams.get("range") as Range) || "1d";
    const shorts = (url.searchParams.get("shorts") as ShortsMode) || "all";
    const sort = (url.searchParams.get("sort") as SortMode) || "trending";
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const take = Math.max(1, Math.min(48, Number(url.searchParams.get("take") || "24")));
    const skip = (page - 1) * take;

    const since = sinceFromRange(range);

    // 97 の挙動を尊重：期間フィルター + shorts 条件 + プラットフォーム
    const where: Prisma.VideoWhereInput = {
      platform: "youtube",
      publishedAt: { gte: since }, // ← 24h/7d/30d の主フィルター
      ...buildShortsFilter(shorts),
    };

    const orderBy = buildOrder(sort);

    // 一覧取得
    const rows = await prisma.video.findMany({
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

    // 応援件数の範囲内集計（SupportEvent モデル前提）
    let supportMap: Record<string, number> = {};
    if (rows.length > 0) {
      const grouped = await prisma.supportEvent.groupBy({
        by: ["videoId"],
        where: {
          videoId: { in: rows.map((r) => r.id) },
          createdAt: { gte: since },
        },
        _count: { videoId: true },
      });
      supportMap = grouped.reduce<Record<string, number>>((acc, g) => {
        acc[g.videoId] = g._count.videoId;
        return acc;
      }, {});
    }

    // 返却：後方互換のため support / support24h の両方を出す
    const items = rows.map((v) => {
      const count = supportMap[v.id] ?? 0;
      return {
        ...v,
        support: count,      // 新規（推奨）
        support24h: count,   // 既存フロントがこれを読む場合に備える
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("[/api/videos] error", e);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
