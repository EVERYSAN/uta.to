import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const PAGE_MAX = 50;        // 1ページの最大件数
const MAX_TOTAL = 1000;     // UI表示の最大件数（総数上限）

// 期間文字列を日数に変換（拡張しやすいようにマップ）
function periodToSinceDate(period: string | null): Date | null {
  if (!period) return null;
  const key = period.toLowerCase();

  const map: Record<string, number> = {
    "1d": 1,
    "day": 1,
    "24h": 1,
    "7d": 7,
    "week": 7,
    "30d": 30,
    "month": 30,
    "90d": 90,
    "3m": 90,
  };

  const days = map[key];
  if (!days) return null;

  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // クエリ
  const q = (searchParams.get("q") ?? "").trim();
  const sortParam = (searchParams.get("sort") ?? "new").toLowerCase(); // new | old | views | likes
  const periodParam = (searchParams.get("period") ?? "all").toLowerCase(); // all | 1d | 7d | 30d | 90d...
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const take = Math.min(PAGE_MAX, Math.max(1, parseInt(searchParams.get("take") ?? "50", 10)));

  // 検索条件(where)
  let where: Prisma.VideoWhereInput | undefined = undefined;

  if (q.length > 0) {
    where = {
      OR: [
        { title: { contains: q, mode: "insensitive" as const } },
        { description: { contains: q, mode: "insensitive" as const } },
        { channelTitle: { contains: q, mode: "insensitive" as const } },
      ],
    };
  }

  // 期間フィルタ：publishedAt が “since 以降”
  const since = periodToSinceDate(periodParam === "all" ? null : periodParam);
  if (since) {
    where = {
      ...(where ?? {}),
      publishedAt: { gte: since },
    };
  }

  // 並び順
  type SortKey = "new" | "old" | "views" | "likes";
  const sort = (["new", "old", "views", "likes"].includes(sortParam) ? sortParam : "new") as SortKey;

  // Prisma の orderBy は nulls 指定ができないので、
  // views/likes のときだけ null を除外して“0含む”でソートできるように where を拡張
  if (sort === "views") {
    where = { ...(where ?? {}), views: { not: null } };
  }
  if (sort === "likes") {
    where = { ...(where ?? {}), likes: { not: null } };
  }

  const orderBy: Prisma.VideoOrderByWithRelationInput[] =
    sort === "new"
      ? [{ publishedAt: "desc" }]
      : sort === "old"
      ? [{ publishedAt: "asc" }]
      : sort === "views"
      ? [{ views: "desc" }, { publishedAt: "desc" }]
      : [{ likes: "desc" }, { publishedAt: "desc" }];

  // 総数（UI側の上限にも合わせる）
  const total = Math.min(
    MAX_TOTAL,
    await prisma.video.count({ where })
  );

  const items = await prisma.video.findMany({
    where,
    orderBy,
    take,
    skip: (page - 1) * take,
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
  });

  return NextResponse.json({
    ok: true,
    total,
    page,
    take,
    period: periodParam,
    sort,
    items,
  });
}
