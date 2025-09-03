import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma"; // いつものやつ

// ?range=24h|7d|30d  /  ?sort=trend|support  /  ?long=1
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = (searchParams.get("range") ?? "24h") as "24h" | "7d" | "30d";
  const sort  = (searchParams.get("sort")  ?? "trend") as "trend" | "support";
  const longOnly = searchParams.get("long") === "1";

  const now = new Date();
  const from = new Date(now);
  if (range === "24h") from.setHours(from.getHours() - 24);
  if (range === "7d")  from.setDate(from.getDate() - 7);
  if (range === "30d") from.setDate(from.getDate() - 30);

  // ① Video は「公開日」「ロング動画」など“単体条件のみ”で取得する
  const videoWhere: any = {
    publishedAt: { gte: from, lte: now },
  };
  if (longOnly) {
    // 60秒以上をロング扱い（durationSec が null のものも許容）
    videoWhere.OR = [{ durationSec: { gte: 60 } }, { durationSec: null }];
    // shorts を除外したいならこちらでもOK
    // videoWhere.url = { not: { contains: "/shorts/" } };
  }

  // ② LEFT JOIN 的に SupportSnapshot を“付ける”が、存在しなくても Video は返す
  const rows = await prisma.video.findMany({
    where: videoWhere,
    include: {
      supportSnapshots: {
        where: { windowStart: { gte: from } }, // ← ここは親を絞らない（include なので OK）
        select: { value: true },               // フィールド名はあなたのスキーマに合わせて
      },
    },
    // いったんソートは後段で JS 側でやる（DB で集計しないので）
  });

  // ③ 応援ポイントを 0 デフォルトで集計
  const list = rows.map(v => {
    const support = (v.supportSnapshots ?? []).reduce((acc, s) => acc + (s.value ?? 0), 0);
    return {
      id: v.id,
      title: v.title,
      url: v.url,
      durationSec: v.durationSec,
      thumbnailUrl: v.thumbnailUrl,
      channelTitle: v.channelTitle,
      publishedAt: v.publishedAt,
      supportCount: support, // ← 無ければ 0
      // 必要なら views/likes 等も
    };
  });

  // ④ 並び替え：trend はとりあえず「応援降順→新しい順」、support は応援降順
  if (sort === "support") {
    list.sort((a, b) => b.supportCount - a.supportCount || (+b.publishedAt - +a.publishedAt));
  } else {
    // "急上昇(ロング優先)" の簡易版：応援降順→公開日の新しさ
    list.sort((a, b) => b.supportCount - a.supportCount || (+b.publishedAt - +a.publishedAt));
  }

  return NextResponse.json({ items: list });
}
