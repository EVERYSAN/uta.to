// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// 「ショート除外」は 61〜300 秒をメインに、duration 未収集(null)も許容
const MIN_LONG_SEC = 61;
const MAX_LONG_SEC = 300;

type ShortsMode = "all" | "exclude";
type RangeKey = "1d" | "7d" | "30d";

/** 期間の下限日付（簡易版） */
function rangeToDateLowerBound(range: RangeKey): Date {
  const now = new Date();
  const d = new Date(now);
  if (range === "1d") d.setDate(now.getDate() - 1);
  else if (range === "7d") d.setDate(now.getDate() - 7);
  else d.setDate(now.getDate() - 30);
  return d;
}

/** 並びを決定的にする orderBy（タイブレークまで固定） */
function stableOrderBy() {
  // Prisma 5 + Postgres なら nulls 指定OK。型の都合で as any で通します
  return [
    { views: { sort: "desc", nulls: "last" } } as any,
    { likes: { sort: "desc", nulls: "last" } } as any,
    { publishedAt: { sort: "desc", nulls: "last" } } as any,
    { id: "asc" as const },
  ];
  // もし nulls 指定で型エラーが出る環境なら下記に差し替え:
  // return [{ views: "desc" as const }, { likes: "desc" as const }, { publishedAt: "desc" as const }, { id: "asc" as const }];
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const sp = url.searchParams;

    const range = (sp.get("range") as RangeKey) || "1d";
    const shortsRaw = (sp.get("shorts") as ShortsMode | "only") || "all";
    const shorts: ShortsMode = shortsRaw === "exclude" ? "exclude" : "all";

    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const take = Math.min(50, Math.max(1, parseInt(sp.get("take") ?? "24", 10) || 24));
    const skip = (page - 1) * take;

    const q = (sp.get("q") ?? "").trim();

    // ---- where ----
    const where: Prisma.VideoWhereInput = { platform: "youtube" };

    // 期間（下限）
    where.publishedAt = { gte: rangeToDateLowerBound(range) };

    // キーワード
    if (q.length > 0) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { channelTitle: { contains: q, mode: "insensitive" } },
        // { description: { contains: q, mode: "insensitive" } }, // 説明カラムがあるなら
      ];
    }

    // ショート除外: 61〜300秒 or 未収集(null) を許容
    if (shorts === "exclude") {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Prisma.VideoWhereInput[]) : []),
        {
          OR: [
            { durationSec: { gte: MIN_LONG_SEC, lte: MAX_LONG_SEC } },
            { durationSec: null },
          ],
        },
      ];
    }

    // ---- 取得 ----
    const [items, total] = await Promise.all([
      prisma.video.findMany({
        where,
        orderBy: stableOrderBy(),
        skip,
        take,
        select: {
          id: true,
          platform: true,
          platformVideoId: true,
          title: true,
          url: true,
          thumbnailUrl: true,
          durationSec: true,
          publishedAt: true,
          channelTitle: true,
          views: true,
          likes: true,
        },
      }),
      prisma.video.count({ where }),
    ]);

    return NextResponse.json(
      { ok: true, items, page, take, total },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
