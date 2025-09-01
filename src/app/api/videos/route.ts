// /src/app/api/videos/route.ts
import { NextRequest } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const toInt = (v: string | null, d: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
};

type SortKey = "trending" | "new" | "views" | "likes";
type RangeKey = "1d" | "7d" | "30d";
type ShortsMode = "all" | "exclude" | "only";

const RANGE_TO_HOURS: Record<RangeKey, number> = {
  "1d": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
};

// 60秒以下をショート、61〜300秒を“通常”とみなす
const MAX_SHORT_SEC = 60;
const MIN_LONG_SEC = 61;
const MAX_LONG_SEC = 300;

// 返却フィールド
const videoSelect = {
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
} satisfies Prisma.VideoSelect;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const q = (sp.get("q") ?? "").trim();
    const sort = (sp.get("sort") ?? "trending") as SortKey;
    const range = (sp.get("range") ?? "1d") as RangeKey;
    const shorts = (sp.get("shorts") ?? "all") as ShortsMode;

    const page = Math.max(1, toInt(sp.get("page"), 1));
    const take = Math.min(50, Math.max(1, toInt(sp.get("take"), 50)));
    const skip = (page - 1) * take;

    // ベース where
    let where: Prisma.VideoWhereInput = {
      platform: "youtube",
      ...(q.length > 0
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { channelTitle: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    // ANDの現在値を安全に配列化
    const currAND: Prisma.VideoWhereInput[] = Array.isArray(where.AND)
      ? (where.AND as Prisma.VideoWhereInput[])
      : where.AND
      ? [where.AND as Prisma.VideoWhereInput]
      : [];

    // 尺ベースのショート切替
    if (shorts === "exclude") {
      // 61〜300秒を優先。durationSec=null(古いデータ)は許容して落ちすぎを防止
      where.AND = [
        ...currAND,
        { OR: [{ durationSec: { gte: MIN_LONG_SEC, lte: MAX_LONG_SEC } }, { durationSec: null }] },
      ];
    } else if (shorts === "only") {
      where.AND = [...currAND, { durationSec: { lte: MAX_SHORT_SEC } }];
    } else {
      // all のときは currAND を維持
      if (currAND.length > 0) where.AND = currAND;
    }

    // いったん件数（trending は後で上書き）
    let total = await prisma.video.count({ where });

    // ---- ソート別 ----
    if (sort === "trending") {
      const hours = RANGE_TO_HOURS[range] ?? 24;
      const since = new Date(Date.now() - hours * 3600 * 1000);

      const trendWhere: Prisma.VideoWhereInput = {
        ...where,
        publishedAt: { gte: since },
      };

      const candidates = await prisma.video.findMany({
        where: trendWhere,
        orderBy: [{ publishedAt: "desc" }],
        take: 1000,
        select: videoSelect,
      });

      total = candidates.length;

      const now = Date.now();
      const scored = candidates.map((v) => {
        const ageHrs =
          v.publishedAt ? (now - new Date(v.publishedAt).getTime()) / 3600000 : 9999;
        const views = v.views ?? 0;
        const likes = v.likes ?? 0;
        const score = (views + likes * 5) / Math.pow(ageHrs + 2, 1.5);
        return { v, score };
      });

      scored.sort((a, b) => b.score - a.score);

      const items = scored.slice(skip, skip + take).map((s) => s.v);
      return Response.json({ ok: true, total, page, take, items });
    }

    let orderBy: Prisma.VideoOrderByWithRelationInput[] = [];
    if (sort === "new") {
      orderBy = [{ publishedAt: "desc" }];
    } else if (sort === "views") {
      orderBy = [{ views: "desc" }, { publishedAt: "desc" }];
    } else if (sort === "likes") {
      orderBy = [{ likes: "desc" }, { publishedAt: "desc" }];
    } else {
      orderBy = [{ publishedAt: "desc" }];
    }

    const rows = await prisma.video.findMany({
      where,
      orderBy,
      skip,
      take,
      select: videoSelect,
    });

    return Response.json({ ok: true, total, page, take, items: rows });
  } catch (err: any) {
    console.error("GET /api/videos error", err);
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
