// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 応援ポイントの重み（必要なら調整OK）
const WEIGHT = {
  hearts: 1,
  flames: 3,
  supporters: 10,
} as const;

type Range = "1d" | "7d" | "30d";
type ShortsMode = "exclude" | "all";
type SortMode = "trending" | "points";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // ---- クエリ取得（既定値あり） ----
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") | 0);
    const take = Math.min(48, Math.max(1, Number(searchParams.get("take") ?? "24") | 0));

    const rangeParam = (searchParams.get("range") as Range) ?? "1d";
    const range: Range = ["1d", "7d", "30d"].includes(rangeParam) ? rangeParam : "1d";

    const shortsParam = (searchParams.get("shorts") as ShortsMode) ?? "exclude";
    const shorts: ShortsMode = ["exclude", "all"].includes(shortsParam) ? shortsParam : "exclude";

    const sortParam = (searchParams.get("sort") as SortMode) ?? "trending";
    const sort: SortMode = ["trending", "points"].includes(sortParam) ? sortParam : "trending";

    const now = new Date();
    const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // ---- ロング動画（61秒〜）/ shorts 除外のフィルタ ----
    const longFilter =
      shorts === "exclude"
        ? {
            OR: [
              { durationSec: { gte: 61 } }, // 61秒からロング
              { durationSec: { equals: null } }, // 取得できていないものは許容
            ],
          }
        : {};

    const notShortsPath =
      shorts === "exclude"
        ? {
            OR: [
              { url: { not: { contains: "/shorts/" } } },
              { url: { equals: null } }, // URL未設定は許容
            ],
          }
        : {};

    // ---- 期間内の応援集計（SupportSnapshot） ----
    // ※ schema 側は SupportSnapshot に hearts / flames / supporters と createdAt がある前提
    const grouped = await prisma.supportSnapshot.groupBy({
      by: ["videoId"],
      where: { createdAt: { gte: from } },
      _sum: { hearts: true, flames: true, supporters: true },
    });

    // videoId -> 期間内の応援ポイント
    const supportMap = new Map<string, number>();
    for (const g of grouped) {
      const h = g._sum.hearts ?? 0;
      const f = g._sum.flames ?? 0;
      const s = g._sum.supporters ?? 0;
      const points = h * WEIGHT.hearts + f * WEIGHT.flames + s * WEIGHT.supporters;
      supportMap.set(g.videoId, points);
    }
    const supportedIds = grouped.map((g) => g.videoId);

    // ---- 候補動画の母集団（発行日が期間内 or 応援が期間内） ----
    const candidates = await prisma.video.findMany({
      where: {
        AND: [
          longFilter,
          notShortsPath,
          {
            OR: [
              { publishedAt: { gte: from } },
              { id: { in: supportedIds.length ? supportedIds : ["__nohit__"] } }, // 空配列対策
            ],
          },
        ],
      },
      // Video に存在する列のみ選択（存在しない列は選ばない！）
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

    // ---- スコア計算（サーバー側で算出して安定化） ----
    const withScore = candidates.map((v) => {
      const support = supportMap.get(v.id) ?? 0;

      // 発行日時が無ければ古い扱い（時間減衰を強めに）
      const published = v.publishedAt ? new Date(v.publishedAt).getTime() : now.getTime() - 90 * 24 * 3600 * 1000;
      const hours = Math.max(1, (now.getTime() - published) / 3600000);

      // 急上昇: 応援 / (経過(24h)の0.35乗) にロング微ブースト
      let trend = support / Math.pow(hours / 24, 0.35);
      if ((v.durationSec ?? 999999) >= 61) trend *= 1.05;

      return {
        ...v,
        // フロント向けの追加プロパティ
        supportInRange: support,
        _trendScore: trend,
      };
    });

    // ---- ソート & ランク付け ----
    withScore.sort((a, b) => {
      if (sort === "points") {
        if (b.supportInRange !== a.supportInRange) return (b.supportInRange ?? 0) - (a.supportInRange ?? 0);
        // 同点なら新しい方
        return (new Date(b.publishedAt ?? 0).getTime() || 0) - (new Date(a.publishedAt ?? 0).getTime() || 0);
      } else {
        if (b._trendScore !== a._trendScore) return (b._trendScore ?? 0) - (a._trendScore ?? 0);
        return (new Date(b.publishedAt ?? 0).getTime() || 0) - (new Date(a.publishedAt ?? 0).getTime() || 0);
      }
    });

    const total = withScore.length;
    const start = (page - 1) * take;
    const end = start + take;
    const sliced = withScore.slice(start, end).map((v, idx) => ({
      id: v.id,
      title: v.title,
      url: v.url,
      thumbnailUrl: v.thumbnailUrl,
      durationSec: v.durationSec,
      publishedAt: v.publishedAt ? new Date(v.publishedAt).toISOString() : null,
      channelTitle: v.channelTitle,
      views: v.views,
      likes: v.likes,
      supportInRange: v.supportInRange,
      trendingRank: start + idx + 1, // 1始まりでランキング
    }));

    return NextResponse.json({ ok: true, page, take, total, items: sliced }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("GET /api/videos error", err);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }
}
