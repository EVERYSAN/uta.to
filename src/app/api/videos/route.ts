/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// このAPIは毎回最新を取りたいのでキャッシュ無効化
export const dynamic = "force-dynamic";

type Range = "24h" | "7d" | "30d";
type ShortsMode = "any" | "only" | "exclude";
type Sort = "trending" | "new";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const range = (searchParams.get("range") as Range) ?? "24h";
    const shorts = (searchParams.get("shorts") as ShortsMode) ?? "any";
    const sort = (searchParams.get("sort") as Sort) ?? "trending";

    const take = clampInt(searchParams.get("take"), 24, 1, 100);
    const page = clampInt(searchParams.get("page"), 1, 1, 10000);
    const skip = (page - 1) * take;

    // 期間
    const windowMs =
      range === "24h" ? 24 * 3600_000 : range === "7d" ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000;
    const from = new Date(Date.now() - windowMs);

    // shorts フィルタ（型安全に）
    // - ロング: 61秒以上 かつ URLに /shorts/ を含まない
    // - ショート: 60秒以下 または URLに /shorts/ を含む
    const where: any = {
      publishedAt: { gte: from },
    };

    if (shorts === "exclude") {
      // ロングのみ
      where.AND = [
        { durationSec: { gte: 61 } }, // 61秒以上
        { OR: [{ url: { not: { contains: "/shorts/" } } }, { url: { startsWith: "http" } }] },
      ];
    } else if (shorts === "only") {
      // ショートのみ
      where.OR = [{ durationSec: { lt: 61 } }, { url: { contains: "/shorts/" } }];
    }
    // shorts === "any" の場合は何も追加しない

    // 一旦「新着順」で取得 → trending のときは後でアプリ側でスコアリング
    const videos = await prisma.video.findMany({
      where,
      select: {
        id: true,
        title: true,
        channelTitle: true,
        url: true,
        thumbnail: true,
        durationSec: true,
        publishedAt: true, // Date | null でもOKなように後でガード
        views: true,
        likes: true,
      },
      orderBy: { publishedAt: "desc" },
      skip,
      take,
    });

    let items = videos;

    if (sort === "trending") {
      const now = Date.now();
      items = [...videos].sort((a, b) => {
        const aMs = a.publishedAt ? new Date(a.publishedAt).getTime() : now;
        const bMs = b.publishedAt ? new Date(b.publishedAt).getTime() : now;

        const aHours = Math.max(1, (now - aMs) / 3600_000);
        const bHours = Math.max(1, (now - bMs) / 3600_000);

        const aBase = (a.likes ?? 0) + (a.views ?? 0) / 50;
        const bBase = (b.likes ?? 0) + (b.views ?? 0) / 50;

        // 新しいほど強くなるよう緩やかに減衰
        const aScore = aBase / Math.pow(aHours / 24, 0.35);
        const bScore = bBase / Math.pow(bHours / 24, 0.35);

        return bScore - aScore;
      });
    }

    return NextResponse.json({
      items,
      page,
      take,
      count: items.length,
    });
  } catch (err: any) {
    console.error("[/api/videos] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "internal error" },
      { status: 500 }
    );
  }
}

function clampInt(src: string | null, def: number, min: number, max: number) {
  const n = src ? parseInt(src, 10) : def;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
