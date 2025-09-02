import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// 時間範囲のヘルパ
const RANGE_HOURS: Record<string, number> = {
  "1d": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
};

// 数値パース
const toInt = (v: string | null, def: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : def;
};

// 経過時間（時間）
const ageHours = (d: Date) => (Date.now() - new Date(d).getTime()) / 3600000;

// トレンドスコア（views と likes が null の場合は 0 扱い）
const trendScore = (views: number | null, likes: number | null, publishedAt: Date) => {
  const v = views ?? 0;
  const l = likes ?? 0;
  // ざっくり：高評価を強めに重み付け、時間減衰
  const raw = v + l * 8;
  return raw / Math.pow(ageHours(publishedAt) + 2, 1.3);
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const q = (sp.get("q") ?? "").trim();
  const sort = sp.get("sort") ?? "trending";          // 将来拡張用（今は "trending" 前提）
  const range = sp.get("range") ?? "1d";               // 1d | 7d | 30d
  const shorts = (sp.get("shorts") ?? "all") as "all" | "exclude"; // すべて / ショート除外
  const page = Math.max(1, toInt(sp.get("page"), 1));
  const take = Math.min(50, Math.max(1, toInt(sp.get("take"), 50)));

  const hours = RANGE_HOURS[range] ?? 24;
  const since = new Date(Date.now() - hours * 3600 * 1000);

  // 基本の where
  let where: Prisma.VideoWhereInput = {
    platform: "youtube",
    publishedAt: { gte: since },
  };

  // キーワード
  if (q.length > 0) {
    where = {
      AND: [
        where,
        {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { channelTitle: { contains: q, mode: "insensitive" } },
          ],
        },
      ],
    };
  }

  // 「ショート除外」= 61秒〜5分の範囲に絞る
  if (shorts === "exclude") {
    where = {
      AND: [
        where,
        {
          durationSec: { gte: 61, lte: 300 },
        },
      ],
    };
  }

  // まず候補を多めに取得（最大 500）してから JS 側でトレンド順に並べ替える
  const candidates = await prisma.video.findMany({
    where,
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
      views: true,   // null 可
      likes: true,   // null 可
    },
    orderBy: { publishedAt: "desc" }, // 安定化のため一度日時で並べる
    take: 500,
  });

  // トレンドスコア算出＆安定化ソート
  const ranked = candidates
    .map(v => ({
      ...v,
      _score: trendScore(v.views, v.likes, v.publishedAt),
    }))
    .sort((a, b) =>
      b._score - a._score ||
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() ||
      a.id.localeCompare(b.id)
    );

  const total = ranked.length;
  const start = (page - 1) * take;
  const items = ranked.slice(start, start + take).map(({ _score, ...rest }) => rest);

  return NextResponse.json({
    ok: true,
    total,
    page,
    take,
    items,
  });
}
