// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Range = "24h" | "7d" | "30d";
type ShortsMode = "any" | "exclude" | "only";

function fromByRange(range: Range): Date {
  const now = Date.now();
  if (range === "24h") return new Date(now - 24 * 3600_000);
  if (range === "7d")  return new Date(now - 7  * 24 * 3600_000);
  return new Date(now - 30 * 24 * 3600_000);
}

// shorts フィルタを Prisma の where に変換
function shortsWhere(mode: ShortsMode) {
  if (mode === "exclude") {
    // 60秒“以下”をショート扱い。ロングは 61秒以上。
    // URLに /shorts/ を含むものも除外
    return {
      AND: [
        { OR: [{ durationSec: { gte: 61 } }, { durationSec: null }] },
        { NOT: { url: { contains: "/shorts/" } } },
      ],
    };
  }
  if (mode === "only") {
    return {
      OR: [{ durationSec: { lt: 61 } }, { url: { contains: "/shorts/" } }],
    };
  }
  return {}; // any
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const range = (searchParams.get("range") ?? "24h") as Range;
  const shorts = (searchParams.get("shorts") ?? "any") as ShortsMode;
  const sort   = (searchParams.get("sort") ?? "trending") as "trending" | "latest";
  const page   = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const take   = Math.min(50, Math.max(1, Number(searchParams.get("take") ?? "24")));
  const offset = (page - 1) * take;

  const from = fromByRange(range);

  // まず期間・shorts 条件でプールを多めに取得（後でスコア計算してページング）
  const pool = await prisma.video.findMany({
    where: {
      publishedAt: { gte: from },
      ...shortsWhere(shorts),
    },
    orderBy: { publishedAt: "desc" },               // 新しい順でプール
    take: offset + take + 120,                      // ページ分 + 余裕
    select: {
      id: true,
      title: true,
      channelTitle: true,
      url: true,
      thumbnailUrl: true,                           // ← ここが修正点（thumbnail → thumbnailUrl）
      durationSec: true,
      publishedAt: true,                            // Date | null
      views: true,
      likes: true,
    },
  });

  const now = Date.now();

  // “急上昇”スコアを計算（応援テーブル無しでも動く簡易版）
  const scored = pool.map(v => {
    const pubMs =
      v.publishedAt instanceof Date
        ? v.publishedAt.getTime()
        : v.publishedAt
        ? new Date(v.publishedAt as unknown as string).getTime()
        : now; // null は “今” とみなして減衰ゼロに偏らないよう max(1h) で下駄を履かせる

    const ageHours = Math.max(1, (now - pubMs) / 3_600_000);
    const base = (v.likes ?? 0) + (v.views ?? 0) / 50;
    const isLong = v.durationSec != null && v.durationSec >= 61; // 61秒以上をロング
    let score = base / Math.pow(ageHours / 24, 0.35);
    if (isLong) score *= 1.05; // ロング微ブースト（好みに応じて調整可）
    return { ...v, _score: score, _pubMs: pubMs };
  });

  const ranked =
    sort === "latest"
      ? scored.sort((a, b) => b._pubMs - a._pubMs)
      : scored.sort((a, b) => b._score - a._score);

  const pageItems = ranked.slice(offset, offset + take).map(v => {
    // 内部用フィールドは返さない
    // UI 互換：thumbnailUrl / durationSec / views / likes / publishedAt などそのまま返却
    // （既存フロントがこの形で読んでいる前提）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _score, _pubMs, ...rest } = v;
    return rest;
  });

  return NextResponse.json({
    items: pageItems,
    total: scored.length,
    page,
    take,
    range,
    shorts,
    sort,
  });
}
