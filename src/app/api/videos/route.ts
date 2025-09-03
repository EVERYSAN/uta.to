// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Range = "1d" | "7d" | "30d";
type ShortsMode = "exclude" | "all";
type SortMode = "trending" | "points";

function parseParams(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") || 1));
  const take = Math.min(48, Math.max(1, Number(sp.get("take") || 24)));
  const range = (sp.get("range") as Range) || "1d";
  const shorts = (sp.get("shorts") as ShortsMode) || "exclude";
  const sort = (sp.get("sort") as SortMode) || "trending";
  return { page, take, range, shorts, sort };
}

function rangeToSince(range: Range) {
  const now = Date.now();
  const hours = range === "1d" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  return new Date(now - hours * 3600_000);
}

export async function GET(req: NextRequest) {
  const { page, take, range, shorts, sort } = parseParams(req);
  const since = rangeToSince(range);
  const now = new Date();

  // ---- 1) 期間 & Shorts 条件だけで候補を広めに取得（後で JS ソートするため少し多め）
  const pool = Math.min(600, page * take * 3);

  const whereBase: any = {
    publishedAt: { gte: since },
  };

  if (shorts === "exclude") {
    // URL に /shorts/ を含むものを除外 + 長さが分かる場合 60 秒以上だけ通す
    whereBase.AND = [
      { NOT: { url: { contains: "/shorts/" } } },
      { OR: [{ durationSec: { gte: 60 } }, { durationSec: null }] },
    ];
  }

  const candidates = await prisma.video.findMany({
    where: whereBase,
    orderBy: { publishedAt: "desc" }, // フォールバック並び
    take: pool,
    select: {
      id: true,
      title: true,
      url: true,
      platform: true,
      platformVideoId: true,
      thumbnailUrl: true,
      channelTitle: true,
      durationSec: true,
      publishedAt: true,
      // フロントで表示している累計系
      views: true,
      likes: true,
      description: true,
    },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, items: [], page, take, total: 0 });
  }

  const ids = candidates.map((v) => v.id);

  // ---- 2) SupportSnapshot を「左集計」して 0 を許容
  // NOTE: スキーマのカラム名が違う場合は createdAt/points を合わせてください。
  let sums: Array<{ videoId: string; _sum: { points: number | null } }> = [];
  try {
    sums = await (prisma as any).supportSnapshot.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: ids },
        createdAt: { gte: since }, // ← snapshot タイムスタンプ列名
      },
      _sum: { points: true }, // ← 期間内の応援ポイント合計の列名
    });
  } catch {
    // スナップショット未作成でも動くように（全部 0 扱い）
    sums = [];
  }

  const supportMap = new Map<string, number>();
  for (const row of sums) supportMap.set(row.videoId, row._sum.points ?? 0);

  // ---- 3) スコア計算 & 並び替え
  const scored = candidates.map((v) => {
    const supportInRange = supportMap.get(v.id) ?? 0;
    const publishedAt = v.publishedAt ? new Date(v.publishedAt) : now;
    const hoursSince = Math.max(1, (now.getTime() - publishedAt.getTime()) / 3600_000);

    // 急上昇スコア：期間内応援に時間減衰（新しいほど強い）
    let trendingScore = supportInRange / Math.pow(hoursSince / 24, 0.35);

    return { ...v, supportInRange, _score: trendingScore };
  });

  if (sort === "points") {
    scored.sort(
      (a, b) =>
        (b.supportInRange ?? 0) - (a.supportInRange ?? 0) ||
        new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()
    );
  } else {
    scored.sort(
      (a, b) =>
        (b._score ?? 0) - (a._score ?? 0) ||
        new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()
    );
  }

  // ランクは全体順位から計算（ページ外も含めて順位づけ）
  const rankMap = new Map<string, number>();
  scored.forEach((v, i) => rankMap.set(v.id, i + 1));

  const total = scored.length;
  const start = (page - 1) * take;
  const slice = scored.slice(start, start + take).map((v) => ({
    id: v.id,
    title: v.title,
    url: v.url,
    platform: v.platform,
    platformVideoId: v.platformVideoId,
    thumbnailUrl: v.thumbnailUrl,
    channelTitle: v.channelTitle,
    durationSec: v.durationSec,
    publishedAt: v.publishedAt as any, // -> フロントは string | null で受ける
    views: v.views,
    likes: v.likes,
    description: v.description,
    supportInRange: v.supportInRange ?? 0,
    trendingRank: rankMap.get(v.id) ?? null,
  }));

  return NextResponse.json({ ok: true, items: slice, page, take, total });
}
