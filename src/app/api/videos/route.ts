// /src/app/api/videos/route.ts
import { NextRequest } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 便利関数
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

// ショートの境界（60秒以下をショート）
const MAX_SHORT_SEC = 60;
const MIN_LONG_SEC = 61;
const MAX_LONG_SEC = 300;

// レスポンスで返す共通の select
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

    // ベースの where
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

    // --- 尺ベースのショート絞り込み ---
    if (shorts === "exclude") {
      // 61〜300秒を優先しつつ、durationSec=null の古いレコードは許容
      where.AND = [
        ...(where.AND ?? []),
        { OR: [{ durationSec: { gte: MIN_LONG_SEC, lte: MAX_LONG_SEC } }, { durationSec: null }] },
      ];
    } else if (shorts === "only") {
      // 60秒以下のみ
      where.AND = [...(where.AND ?? []), { durationSec: { lte: MAX_SHORT_SEC } }];
    }
    // -------------------------------

    // 共通の件数（trending は期間で絞るので後で上書きする）
    let total = await prisma.video.count({ where });

    // ---- ソートごとに処理 ----
    if (sort === "trending") {
      // 期間内のものを集めてスコア計算（軽量の擬似トレンド）
      const hours = RANGE_TO_HOURS[range] ?? 24;
      const since = new Date(Date.now() - hours * 3600 * 1000);

      const trendWhere: Prisma.VideoWhereInput = {
        ...where,
        publishedAt: { gte: since },
        // views が存在するものを優先（null も許容したい場合はコメントアウト）
        // views: { not: null },
      };

      const candidates = await prisma.video.findMany({
        where: trendWhere,
        orderBy: [{ publishedAt: "desc" }], // まずは新しめから
        take: 1000, // 計算対象の上限（DBが小さいので十分）
        select: videoSelect,
      });

      total = candidates.length;

      const now = Date.now();
      const scored = candidates.map((v) => {
        const ageHrs =
          v.publishedAt ? (now - new Date(v.publishedAt).getTime()) / 3600000 : 9999;
        const views = v.views ?? 0;
        const likes = v.likes ?? 0;

        // 簡易トレンドスコア（適当係数）
        const score = (views + likes * 5) / Math.pow(ageHrs + 2, 1.5);
        return { v, score };
      });

      scored.sort((a, b) => b.score - a.score);

      const items = scored.slice(skip, skip + take).map((s) => s.v);
      return Response.json({ ok: true, total, page, take, items });
    }

    // new / views / likes
    let orderBy: Prisma.VideoOrderByWithRelationInput[] = [];

    if (sort === "new") {
      orderBy = [{ publishedAt: "desc" }];
    } else if (sort === "views") {
      // Postgres は DESC で NULLS LAST がデフォルト
      orderBy = [{ views: "desc" }, { publishedAt: "desc" }];
    } else if (sort === "likes") {
      orderBy = [{ likes: "desc" }, { publishedAt: "desc" }];
    } else {
      // 未知の sort は new と同じ
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
