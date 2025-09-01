// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type SortKey = "trending" | "new" | "old" | "views" | "likes";

function hoursFromRange(r?: string): number {
  const v = (r ?? "1d").toLowerCase();
  if (v === "24h" || v === "1d") return 24;
  if (v === "7d") return 24 * 7;
  if (v === "30d") return 24 * 30;
  return 24;
}

function boolParam(sp: URLSearchParams, key: string) {
  const v = (sp.get(key) ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const q = sp.get("q")?.trim() ?? "";
  const sort = (sp.get("sort") as SortKey) || "trending";
  const range = sp.get("range") || "1d";

  // ★ NEW: #shorts 除外フラグ（デフォルト OFF）
  const excludeShorts = boolParam(sp, "noShorts"); // ?noShorts=1 で除外ON

  // ページング
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(sp.get("take") ?? "50", 10)));
  const skip = (page - 1) * take;

  // ★ 長さフィルタは指定がある時だけ適用（デフォルト適用しない）
  const hasLen =
    sp.has("minSec") || sp.has("maxSec") || boolParam(sp, "len"); // len=1 でもONにできる
  const minSec = Math.max(0, parseInt(sp.get("minSec") ?? "0", 10) || 0);
  const maxSec = Math.max(minSec, parseInt(sp.get("maxSec") ?? "86400", 10) || 86400);

  const where: Prisma.VideoWhereInput = {
    platform: "youtube",

    // キーワード
    ...(q
      ? {
          OR: [
            { title:        { contains: q, mode: "insensitive" } },
            { description:  { contains: q, mode: "insensitive" } },
            { channelTitle: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),

    // ★ #shorts を除外（タイトル/説明/URL をゆるくチェック）
    ...(excludeShorts
      ? {
          NOT: [
            { title:       { contains: "#shorts", mode: "insensitive" } },
            { description: { contains: "#shorts", mode: "insensitive" } },
            { url:         { contains: "/shorts/", mode: "insensitive" } },
          ],
        }
      : {}),

    // ★ 長さフィルタ（ONの時だけ）
    ...(hasLen ? { durationSec: { gte: minSec, lte: maxSec } } : {}),
  };

  // 並び順
  let orderBy: Prisma.VideoOrderByWithRelationInput[] = [];
  if (sort === "trending") {
    const hours = hoursFromRange(range);
    const since = new Date(Date.now() - hours * 3600 * 1000);
    (where as Prisma.VideoWhereInput).publishedAt = { gte: since };
    orderBy = [{ views: "desc" }, { likes: "desc" }, { publishedAt: "desc" }];
  } else if (sort === "new") {
    orderBy = [{ publishedAt: "desc" }];
  } else if (sort === "old") {
    orderBy = [{ publishedAt: "asc" }];
  } else if (sort === "views") {
    orderBy = [{ views: "desc" }, { publishedAt: "desc" }];
  } else if (sort === "likes") {
    orderBy = [{ likes: "desc" }, { publishedAt: "desc" }];
  }

  const [items, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy,
      take,
      skip,
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

  return NextResponse.json({ ok: true, total, page, take, items });
}
