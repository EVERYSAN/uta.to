// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

type SortMode = "trending" | "points" | "newest";
type Range = "1d" | "7d" | "30d";
type ShortsMode = "exclude" | "all";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function rangeSince(range: Range): Date {
  if (range === "1d") return daysAgo(1);
  if (range === "7d") return daysAgo(7);
  return daysAgo(30);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const take = Math.min(48, Math.max(1, parseInt(searchParams.get("take") || "24", 10)));

  const sort = (searchParams.get("sort") as SortMode) || "trending";
  const range = (searchParams.get("range") as Range) || "1d";
  const shorts = (searchParams.get("shorts") as ShortsMode) || "exclude";

  const since = rangeSince(range);

  const videoWhere: any = {
    AND: [
      // 期間で絞る（“新着/急上昇”の意味合いにも合う）
      { publishedAt: { gte: since } },
      shorts === "exclude"
        ? { OR: [{ durationSec: null }, { durationSec: { gt: 60 } }] } // 60秒以下をショート扱い
        : {},
    ],
  };

  // まずベースの候補セットを取る
  // trending は JS 側でスコアリングするので母集団を多めに確保
  if (sort === "trending") {
    const poolSize = Math.max(page * take, 200);

    const base = await prisma.video.findMany({
      where: videoWhere,
      orderBy: [{ publishedAt: "desc" }],
      take: poolSize,
      select: {
        id: true,
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

    const ids = base.map((v) => v.id);
    // SupportEvent を期間内で集計して Map(videoId -> sum) を作る
    const grouped = ids.length
      ? await prisma.supportEvent.groupBy({
          by: ["videoId"],
          where: { videoId: { in: ids }, createdAt: { gte: since } },
          _sum: { amount: true },
        })
      : [];

    const supportMap = new Map<string, number>();
    for (const g of grouped) supportMap.set(g.videoId, g._sum.amount ?? 0);

    const now = Date.now();
    const scored = base
      .map((v) => {
        const published = v.publishedAt ? new Date(v.publishedAt).getTime() : now;
        const hours = Math.max(1, (now - published) / 36e5);
        const views = v.views ?? 0;
        const likes = v.likes ?? 0;
        const support = supportMap.get(v.id) ?? 0;

        // Hot スコア：係数は調整可
        const score = (views / hours) * 0.7 + (likes / hours) * 3 + support * 5;

        return { v, score, supportInRange: support };
      })
      .sort((a, b) => b.score - a.score);

    // ページング
    const start = (page - 1) * take;
    const end = start + take;
    const slice = scored.slice(start, end).map((x, i) => ({
      ...x.v,
      supportInRange: x.supportInRange,
      trendingRank: start + i + 1,
      publishedAt: x.v.publishedAt ? new Date(x.v.publishedAt).toISOString() : null,
    }));

    return NextResponse.json({
      ok: true,
      items: slice,
      page,
      take,
      total: scored.length,
    });
  }

  // points/newest は DB orderBy を使いつつ、SupportEvent の合計を合成して返す
  const orderBy =
    sort === "newest"
      ? [{ publishedAt: "desc" as const }]
      : // points の見た目順序はあとで supportInRange で並べ替えるので公開日順で仮取得
        [{ publishedAt: "desc" as const }];

  const base = await prisma.video.findMany({
    where: videoWhere,
    orderBy,
    skip: (page - 1) * take,
    take,
    select: {
      id: true,
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

  const ids = base.map((v) => v.id);
  const grouped = ids.length
    ? await prisma.supportEvent.groupBy({
        by: ["videoId"],
        where: { videoId: { in: ids }, createdAt: { gte: since } },
        _sum: { amount: true },
      })
    : [];

  const supportMap = new Map<string, number>();
  for (const g of grouped) supportMap.set(g.videoId, g._sum.amount ?? 0);

  let items = base.map((v) => ({
    ...v,
    supportInRange: supportMap.get(v.id) ?? 0,
    trendingRank: null as number | null,
    publishedAt: v.publishedAt ? new Date(v.publishedAt).toISOString() : null,
  }));

  if (sort === "points") {
    items = items.sort((a, b) => {
      if (b.supportInRange !== a.supportInRange) return (b.supportInRange ?? 0) - (a.supportInRange ?? 0);
      // 同点なら公開日/再生などで適当に並べる
      const ad = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bd = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bd - ad;
    });
  }

  return NextResponse.json({ ok: true, items, page, take });
}
