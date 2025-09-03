import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * /api/videos?range=24h|7d|30d&sort=trend|support&long=0|1&limit=36
 * - range   : 集計窓（既定 24h）
 * - sort    : "trend"=急上昇(ロング優先) / "support"=応援順（既定 trend）
 * - long    : 1 ならロング動画のみ表示（既定 0）
 * - limit   : 件数（既定 36）
 *
 * ※ SupportSnapshot が無い動画も必ず返す（0 として扱う）
 * ※ スキーマの差異に強いように snapshot のフィールド名は安全に読み取る
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

  // --- Video 単体条件だけで絞る（←重要：子テーブルでは絞らない）
  const videoWhere: any = {
    publishedAt: { gte: from, lte: now },
  };

  if (longOnly) {
    // ロング動画の判定：60秒以上 or shorts URL ではない
    videoWhere.AND = [
      { OR: [{ durationSec: { gte: 60 } }, { durationSec: null }] },
      { url: { not: { contains: "/shorts/" } } },
    ];
  }

  // --- LEFT JOIN 的に snapshot を付与（where ではなく include で時間窓を絞る）
  const videos = await prisma.video.findMany({
    where: videoWhere,
    orderBy: { publishedAt: "desc" }, // 基本は新しい順、あとでJS側で並び替え
    take: limit * 3, // 後段ソートするので少し多めに取っておく
    include: {
      // モデル名は schema に合わせて OK。relation を作っていない場合はこの include を消しても動きます。
      supportSnapshots: {
        where: { windowStart: { gte: from } },
        select: {
          // フィールド名の差異を吸収するため両方試す（Prisma 型エラー回避で any キャスト併用）
          // score or value のどちらかが入っていれば良い
          // @ts-ignore
          score: true,
          // @ts-ignore
          value: true,
        },
      } as any,
    } as any,
  });

  // 安全な集計ヘルパ
  const sumSupport = (v: any) => {
    const snaps: Array<{ score?: number; value?: number }> =
      (v as any)?.supportSnapshots ?? [];
    if (!Array.isArray(snaps) || snaps.length === 0) return 0;
    return snaps.reduce((acc, s) => acc + (s.score ?? s.value ?? 0), 0);
  };

  const isLong = (v: any) => {
    if (typeof v?.url === "string" && v.url.includes("/shorts/")) return false;
    if (typeof v?.durationSec === "number") return v.durationSec >= 60;
    return true; // 不明ならロング扱い
  };

  // 返却配列の整形 + スコア計算
  const list = videos.map((v) => {
    const support = sumSupport(v);
    const hours = Math.max(1, (now.getTime() - new Date(v.publishedAt).getTime()) / 3600000);

    // 急上昇スコア：応援合計に時間減衰（新しいほど強い）をかけ、ロングは微ブースト
    let trendScore = support / Math.pow(hours / 24, 0.35); // 窓に対して緩やかに減衰
    if (isLong(v)) trendScore *= 1.1; // 「ロング優先」の味付け（従来挙動の維持）

    return {
      id: v.id,
      title: v.title,
      url: v.url,
      channelTitle: v.channelTitle,
      thumbnailUrl: v.thumbnailUrl,
      durationSec: v.durationSec,
      publishedAt: v.publishedAt,
      supportCount: support,
      trendScore,
      isLong: isLong(v),
    };
  });

  // 並び替え
  if (sort === "support") {
    list.sort(
      (a, b) =>
        b.supportCount - a.supportCount ||
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
  } else {
    // trend: 急上昇（ロング優先）
    list.sort(
      (a, b) =>
        b.trendScore - a.trendScore ||
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
  }

  // 最終件数を制限
  const sliced = list.slice(0, limit);

  return NextResponse.json({
    range,
    sort,
    longOnly,
    count: sliced.length,
    items: sliced,
  });
}
