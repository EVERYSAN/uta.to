// /src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type Range = "1d" | "7d" | "30d";
type ShortsMode = "all" | "exclude";
type SortMode = "trending" | "views" | "recent"; // 必要なら増やしてOK

function msOfDays(d: number) {
  return d * 24 * 60 * 60 * 1000;
}

function sinceFromRange(range: Range) {
  const now = Date.now();
  const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
  return new Date(now - msOfDays(days));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const range = (url.searchParams.get("range") as Range) || "1d";
    const shorts = (url.searchParams.get("shorts") as ShortsMode) || "all";
    const sort = (url.searchParams.get("sort") as SortMode) || "trending";
    const page = Number(url.searchParams.get("page") || "1");
    const take = Math.max(1, Math.min(48, Number(url.searchParams.get("take") || "24")));
    const skip = (page - 1) * take;

    // ---- Shorts 除外条件（前回の readonly 配列問題を避けるため普通の配列で） ----
    const shortsFilter: Prisma.VideoWhereInput =
      shorts === "exclude"
        ? {
            AND: [
              {
                OR: [
                  { durationSec: null },      // 不明なら通す
                  { durationSec: { gt: 60 } } // 60秒以下は除外したいので > 60
                ],
              },
              { NOT: { url: { contains: "/shorts/" } } },
            ],
          }
        : {};

    // ---- ベース where ----
    const baseWhere: Prisma.VideoWhereInput = {
      platform: "youtube",
      ...shortsFilter,
    };

    // ---- ソート条件（string → SortOrder の型エラーを避けて明示）----
    const orderBy: Prisma.VideoOrderByWithRelationInput[] =
      sort === "views"
        ? [{ views: "desc" }]
        : sort === "recent"
        ? [{ publishedAt: "desc" }]
        : [{ publishedAt: "desc" }]; // trending はひとまず新しい順（必要なら別ロジックに）

    // ---- 一覧取得 ----
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

    // ---- 応援集計（範囲に応じて SupportEvent を groupBy）----
    const ids = videos.map((v) => v.id);
    let supportMap: Record<string, number> = {};

    if (ids.length > 0) {
      const since = sinceFromRange(range);

      // SupportEvent(videoId, createdAt) 基準で集計
      const grouped = await prisma.supportEvent.groupBy({
        by: ["videoId"],
        where: {
          videoId: { in: ids },
          createdAt: { gte: since },
        },
        _count: { videoId: true },
      });

      supportMap = grouped.reduce<Record<string, number>>((acc, row) => {
        acc[row.videoId] = row._count.videoId;
        return acc;
      }, {});
    }

    // ---- API 返却形に support を合体 ----
    const items = videos.map((v) => ({
      ...v,
      // カードで使いやすい名前。必要なら `support24h` に変えてもOK（下の注意参照）
      support: supportMap[v.id] ?? 0,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error("[/api/videos] error:", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
