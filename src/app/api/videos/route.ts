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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // クエリ
  const q = sp.get("q")?.trim() ?? "";
  const sort = (sp.get("sort") as SortKey) || "trending";
  const range = sp.get("range") || "1d";

  // ページング
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const take = Math.min(50, Math.max(1, parseInt(sp.get("take") ?? "50", 10)));
  const skip = (page - 1) * take;

  // 長さフィルタ（デフォ 61〜300秒 = ショート除外）
  const minSec = Math.max(0, parseInt(sp.get("minSec") ?? "61", 10));
  const maxSec = Math.max(minSec, parseInt(sp.get("maxSec") ?? "300", 10));

  // where は 1回だけ作る
  const where: Prisma.VideoWhereInput = {
    platform: "youtube",
    durationSec: { gte: minSec, lte: maxSec },
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { channelTitle: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  // 急上昇: 期間内に「公開された」動画に絞って再生数順
  let orderBy: Prisma.VideoOrderByWithRelationInput[] = [];
  if (sort === "trending") {
    const hours = hoursFromRange(range);
    const since = new Date(Date.now() - hours * 3600 * 1000);
    // 公開日が期間内のみ
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
