/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * /api/videos?range=24h|7d|30d&sort=trend|support&long=0|1&limit=36
 * - range   : 集計窓（既定 24h）
 * - sort    : "trend"=急上昇(ロング優先) / "support"=応援順（既定 trend）
 * - long    : 1 ならロング動画のみ表示（既定 0）
 * - limit   : 件数（既定 36、最大 100）
 *
 * ※ SupportSnapshot が無い動画も必ず返す（0 として扱う）
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const range = (searchParams.get("range") ?? "24h") as "24h" | "7d" | "30d";
  const sort = (searchParams.get("sort") ?? "trend") as "trend" | "support";
  const longOnly = searchParams.get("long") === "1";
  const limit = Math.min(Number(searchParams.get("limit") ?? 36), 100);

  const now = new Date();
  const from = new Date(now);
  if (range === "24h") from.setHours(from.getHours() - 24);
  if (range === "7d") from.setDate(from.getDate() - 7);
  if (range === "30d") from.setDate(from.getDate() - 30);

  // 子テーブルで絞ると“応援が無い動画”が落ちるため、Video だけを条件にする
  const take = limit * (longOnly ? 5 : 3); // 後段フィルタ・並び替え用に少し多め
  const videos = await prisma.video.findMany({
    where: {
      publishedAt: { gte: from, lte: now },
    },
    orderBy: { publishedAt: "desc" },
    take,
    include: {
      // LEFT JOIN 的にスナップショットを付ける。型の揺れに耐えるため any で緩める
      supportSnapshots: {
        where: { windowStart: { gte: from } },
        select: { score: true, value: true } as any,
      },
    } as any,
  });

  // 集計ヘルパ：score/value のどちらでも合算
  const sumSupport = (v: any) => {
    const snaps: Array<{ score?: number | null; value?: number | null }> =
      (v as any)?.supportSnapshots ?? [];
    if (!Array.isArray(snaps) || snaps.length === 0) return 0;
    return snaps.reduce((acc, s) => acc + (Number(s.score ?? s.value ?? 0) || 0), 0);
  };

  // ロング判定：URLに /shorts/ が入っていればショート。durationSec>=60 をロング。
  const isLong = (v: any) => {
    const url = typeof v?.url === "string" ? v.url : "";
    if (url.includes("/shorts/")) return false;
    const dur = (v as any)?.durationSec;
    if (typeof dur === "number") return dur >= 60;
    return true; // 不明ならロング扱い
  };

  const windowHours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;

  let list = videos.map((v: any) => {
    const support = sumSupport(v);

    // publishedAt は null の可能性に備えて安全に扱う
    const publishedMs = v?.publishedAt
      ? new Date(v.publishedAt as any).getTime()
      : now.getTime();
    const hours = Math.max(1, (now.getTime() - publishedMs) / 3_600_000);

    // 急上昇スコア：応援合計に時間減衰（新しいほど強い）をかけ、ロングは微ブースト
    let trendScore = support / Math.pow(hours / (windowHours || 24), 0.35);
    if (isLong(v)) trendScore *= 1.1; // 「ロング優先」の味付け（従来挙動の維持）

    return {
      id: v.id,
      title: v.title,
      url: v.url,
      channelTitle: v.channelTitle,
      thumbnailUrl: v.thumbnailUrl,
      durationSec: v.durationSec ?? null,
      publishedAt: v.publishedAt,
      supportCount: support,
      trendScore,
      isLong: isLong(v),
    };
  });

  // ロング動画だけにする場合は後段でフィルタ
  if (longOnly) {
    list = list.filter((x) => x.isLong);
  }

  // 並び替え
  if (sort === "support") {
    list.sort(
      (a, b) =>
        b.supportCount - a.supportCount ||
        new Date(b.publishedAt ?? now).getTime() - new Date(a.publishedAt ?? now).getTime()
    );
  } else {
    list.sort(
      (a, b) =>
        b.trendScore - a.trendScore ||
        new Date(b.publishedAt ?? now).getTime() - new Date(a.publishedAt ?? now).getTime()
    );
  }

  // 最終件数を制限
  const items = list.slice(0, limit);

  return NextResponse.json({ range, sort, longOnly, count: items.length, items });
}
