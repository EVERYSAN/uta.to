// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const revalidate = 0;

const prisma = new PrismaClient();

/** range -> 取得開始日時 */
function rangeToFrom(range: string | null): Date {
  const now = new Date();
  switch ((range ?? "24h").toLowerCase()) {
    case "24h":
    case "1d":
      return new Date(now.getTime() - 24 * 3600_000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 3600_000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 3600_000);
    default:
      return new Date(now.getTime() - 24 * 3600_000);
  }
}

/** shorts 除外 + ロング(61s〜)のみ の where を作る */
function buildLongOnlyWhere(searchParams: URLSearchParams): Prisma.VideoWhereInput | undefined {
  // UI は「ロング動画」= shorts を除外する仕様なので、クエリは shorts=exclude を見る
  const shortsParam = searchParams.get("shorts"); // "exclude" | null
  if (shortsParam !== "exclude") return undefined;

  // url はスキーマ上 non-null のはずなので null 比較は使わない（型エラーの原因）
  return {
    AND: [
      { url: { not: { contains: "/shorts/" } } }, // /shorts/ を含む URL を除外
      { durationSec: { gte: 61 } },               // 閾値は 61 秒以上
    ],
  };
}

/** 応援ポイント（集計） */
type SupportSums = Record<
  string,
  { hearts: number; flames: number; supporters: number; points: number }
>;

/** SupportSnapshot を集計して videoId -> 合計 を返す（無ければ 0） */
async function loadSupportSums(videoIds: string[], from: Date): Promise<SupportSums> {
  // SupportSnapshot スキーマは、hearts / flames / supporters がある前提。
  // 型崩れを避けるため groupBy を使わず findMany→手動集計にしている。
  const rows = await prisma.supportSnapshot.findMany({
    where: {
      videoId: { in: videoIds },
      createdAt: { gte: from },
    },
    select: {
      videoId: true,
      hearts: true,
      flames: true,
      supporters: true,
    },
  });

  const map: SupportSums = {};
  for (const id of videoIds) {
    map[id] = { hearts: 0, flames: 0, supporters: 0, points: 0 };
  }
  for (const r of rows) {
    const cur = map[r.videoId] ?? { hearts: 0, flames: 0, supporters: 0, points: 0 };
    cur.hearts += r.hearts ?? 0;
    cur.flames += r.flames ?? 0;
    cur.supporters += r.supporters ?? 0;
    // 重みはハート=1, 炎=3（以前の表示と相性が良い）
    cur.points = cur.hearts + cur.flames * 3;
    map[r.videoId] = cur;
  }
  // points を最後に整合
  for (const id of Object.keys(map)) {
    const v = map[id];
    v.points = (v.hearts ?? 0) + (v.flames ?? 0) * 3;
  }
  return map;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = rangeToFrom(searchParams.get("range"));
    const longOnlyWhere = buildLongOnlyWhere(searchParams);

    // 1) まずは対象動画を取得（公開日時フィルタは DB 側で、ロング/shorts は必要な時のみ）
    const baseWhere: Prisma.VideoWhereInput = {
      publishedAt: { gte: from },
      ...(longOnlyWhere ?? {}),
    };

    const videos = await prisma.video.findMany({
      where: baseWhere,
      select: {
        id: true,
        title: true,
        url: true,
        thumbnailUrl: true,
        channelTitle: true,
        publishedAt: true,
        durationSec: true,
        views: true,
        likes: true,
      },
      orderBy: { publishedAt: "desc" }, // 一旦新しい順で拾う（最終ソートは後で応援ポイントで）
      take: 500, // 安全のため上限
    });

    // 2) SupportSnapshot を左外部結合相当で集計
    const sums = await loadSupportSums(
      videos.map((v) => v.id),
      from
    );

    // 3) マージして応援ポイント降順に整列（= 応援順）
    const list = videos
      .map((v) => {
        const s = sums[v.id] ?? { hearts: 0, flames: 0, supporters: 0, points: 0 };
        return {
          id: v.id,
          title: v.title,
          url: v.url,
          thumbnailUrl: v.thumbnailUrl,
          channelTitle: v.channelTitle,
          publishedAt: v.publishedAt,
          durationSec: v.durationSec,
          views: v.views ?? 0,
          likes: v.likes ?? 0,
          support: s,
        };
      })
      .sort((a, b) => b.support.points - a.support.points);

    return NextResponse.json({
      ok: true,
      range: searchParams.get("range") ?? "24h",
      shorts: searchParams.get("shorts") ?? "include",
      total: list.length,
      videos: list,
    });
  } catch (err: any) {
    console.error("GET /api/videos failed", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
