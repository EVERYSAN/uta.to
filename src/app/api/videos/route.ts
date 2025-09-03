// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// shorts=exclude のときのロング判定（60秒以上 or /shorts/ を含まない）
const longOnlyWhere: Prisma.VideoWhereInput = {
  AND: [
    // 60秒以上（or durationSec が nullable なら null を許容したい場合は schema に合わせて下行を残す）
    { OR: [{ durationSec: { gte: 60 } }, { durationSec: null as any }] },
    // url は非nullフィールドなので null 比較は不可。/shorts/ を含まない条件だけにする
    { url: { not: { contains: "/shorts/" } } },
  ],
};

function parseRange(range: string | null): { key: "1d" | "7d" | "30d"; since: Date } {
  const key = (range === "7d" || range === "30d") ? range : "1d";
  const days = key === "7d" ? 7 : key === "30d" ? 30 : 1;
  return { key, since: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const page = Math.max(1, Number(sp.get("page") || "1"));
    const take = Math.min(48, Math.max(1, Number(sp.get("take") || "24")));
    const { key: rangeKey, since } = parseRange(sp.get("range"));
    const shorts = (sp.get("shorts") === "all" ? "all" : "exclude") as "all" | "exclude";
    const sort = (sp.get("sort") === "points" ? "points" : "trending") as "points" | "trending";

    // 期間内の応援ポイントを集計（SupportSnapshot を使うならここを切替）
    // --- SupportEvent 版 ---
    const sumRows = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { createdAt: { gte: since } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
    });
    // // --- SupportSnapshot 版（導入済みならこっちに切替） ---
    // const sumRows = await prisma.supportSnapshot.groupBy({
    //   by: ["videoId"],
    //   where: { hour: { gte: since } },
    //   _sum: { amount: true },
    //   orderBy: { _sum: { amount: "desc" } },
    // });

    const pointsMap = new Map<string, number>();
    for (const r of sumRows) pointsMap.set(r.videoId, r._sum.amount ?? 0);

    // 候補 ID（points順の上位をベースに取得）— ロング指定があるのであとで where で絞る
    let candidateIds = sumRows.map((r) => r.videoId);

    // 期間内応援イベントが無かった場合のフォールバック
    if (candidateIds.length === 0) {
      const fallbackVideos = await prisma.video.findMany({
        where: {
          publishedAt: { gte: since },
          ...(shorts === "exclude" ? longOnlyWhere : {}),
        },
        orderBy: [{ publishedAt: "desc" }],
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
        take: take * 3,
      });
      candidateIds = fallbackVideos.map((v) => v.id);
      // pointsMap は 0 のまま
    }

    // 候補の動画を取得
    const vids = await prisma.video.findMany({
      where: {
        id: { in: candidateIds },
        ...(shorts === "exclude" ? longOnlyWhere : {}),
      },
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

    // 期間内応援ポイント付与
    const enriched = vids.map((v) => ({
      ...v,
      supportInRange: pointsMap.get(v.id) ?? 0,
    }));

    // スコア計算（trending=簡易Hot、points=期間内応援）
    const withScore = enriched.map((v) => {
      const ageHours = v.publishedAt
        ? Math.max(1, (Date.now() - new Date(v.publishedAt).getTime()) / 36e5)
        : 72;
      const hot =
        (v.supportInRange ?? 0) * 5 +
        (v.likes ?? 0) * 1 +
        Math.floor((v.views ?? 0) / 80) -
        ageHours * 0.1;
      return { ...v, _score: hot };
    });

    let sorted = withScore.sort((a, b) =>
      sort === "points"
        ? (b.supportInRange ?? 0) - (a.supportInRange ?? 0)
        : b._score - a._score
    );

    // points が全員 0 のときは新しい順で読みやすく
    if (sort === "points" && sorted.every((v) => (v.supportInRange ?? 0) === 0)) {
      sorted = sorted.sort((a, b) =>
        (new Date(b.publishedAt ?? 0).getTime()) - (new Date(a.publishedAt ?? 0).getTime())
      );
    }

    // ページング
    const start = (page - 1) * take;
    const items = sorted.slice(start, start + take).map((v, i) => ({
      id: v.id,
      title: v.title,
      url: v.url,
      thumbnailUrl: v.thumbnailUrl,
      durationSec: v.durationSec,
      publishedAt: v.publishedAt as any,
      channelTitle: v.channelTitle,
      views: v.views,
      likes: v.likes,
      supportInRange: v.supportInRange,
      trendingRank: start + i + 1,
    }));

    return NextResponse.json({
      ok: true,
      page,
      take,
      total: sorted.length,
      items,
      range: rangeKey,
      shorts,
      sort,
    });
  } catch (e) {
    console.error("videos api error", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
