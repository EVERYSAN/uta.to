// src/app/api/videos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

declare global {
  // avoid hot-reload excessive clients in dev
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma = global.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

type Range = "24h" | "7d" | "30d";
type Shorts = "any" | "only" | "exclude" | "long";
type Sort = "trending" | "support" | "latest" | "popular";

function fromDate(range: Range) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (range === "24h") return new Date(now - day);
  if (range === "7d") return new Date(now - 7 * day);
  return new Date(now - 30 * day);
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const range = (sp.get("range") as Range) ?? "24h";
    const shorts = (sp.get("shorts") as Shorts) ?? "any";
    const sort = (sp.get("sort") as Sort) ?? "trending";
    const page = Math.max(1, Number(sp.get("page") ?? "1"));
    const take = Math.min(50, Math.max(1, Number(sp.get("take") ?? "24")));
    const debug = sp.get("debug") === "1";

    const from = fromDate(range);
    const where: Prisma.VideoWhereInput = {
      // publishedAt が null のレコードはウィンドウから除外
      publishedAt: { gte: from },
    };

    // Shorts/Long フィルタ
    if (shorts === "only") {
      // 60 秒未満 or /shorts/ をショート扱い
      where.OR = [
        { url: { contains: "/shorts/" } },
        { durationSec: { lt: 60 } },
      ];
    } else if (shorts === "exclude" || shorts === "long") {
      where.AND = [
        { NOT: { url: { contains: "/shorts/" } } },
        // 61 秒以上（欠損は許容）
        { OR: [{ durationSec: { gte: 61 } }, { durationSec: null }] },
      ];
    }
    // shorts === "any" の場合は何もしない

    // まずは候補プールを取る（多めに）
    const pool = await prisma.video.findMany({
      where,
      select: {
        id: true,
        title: true,
        channelTitle: true,
        url: true,
        thumbnailUrl: true, // ← ここは thumbnail ではなく thumbnailUrl
        durationSec: true,
        publishedAt: true,
        views: true,
        likes: true,
      },
      orderBy:
        sort === "latest"
          ? [{ publishedAt: "desc" }]
          : sort === "popular"
          ? [{ views: "desc" }]
          : [{ publishedAt: "desc" }], // trending/support 用の仮並び（新しい順）
      take: Math.max(take * 6, 200), // スコアリング前なので多めに確保
    });

    // SupportSnapshot があるなら期間内の応援ポイントを集計
    type SupportMap = Record<
      string,
      { hearts: number; flames: number; supporters: number; points: number }
    >;
    const support: SupportMap = {};
    if (sort === "support" || sort === "trending") {
      try {
        const g = await (prisma as any).supportSnapshot.groupBy({
          by: ["videoId"],
          where: { createdAt: { gte: from } },
          _sum: { hearts: true, flames: true, supporters: true },
        });
        for (const row of g as Array<{
          videoId: string;
          _sum: { hearts: number | null; flames: number | null; supporters: number | null };
        }>) {
          const hearts = row._sum.hearts ?? 0;
          const flames = row._sum.flames ?? 0;
          const supporters = row._sum.supporters ?? 0;
          const points = hearts + flames * 5 + supporters * 15;
          support[row.videoId] = { hearts, flames, supporters, points };
        }
      } catch {
        // テーブルが無い環境（P2021 等）は無視して 0 として扱う
      }
    }

    // スコアリング（トレンド）
    const now = Date.now();
    const scored = pool.map((v) => {
      const ageHours = Math.max(
        1,
        v.publishedAt ? (now - new Date(v.publishedAt).getTime()) / 3_600_000 : 9_999
      );
      const base = (v.likes ?? 0) + (v.views ?? 0) / 50;
      let trend = base / Math.pow(ageHours / 24, 0.35); // ゆるやか減衰

      const sup = support[v.id]?.points ?? 0;
      trend += sup * 0.3; // 応援があれば少しブースト

      return {
        ...v,
        support: sup,
        trendScore: trend,
      };
    });

    // 並び替え
    if (sort === "support") {
      scored.sort((a, b) => (b.support ?? 0) - (a.support ?? 0));
    } else if (sort === "trending") {
      scored.sort((a, b) => (b.trendScore ?? 0) - (a.trendScore ?? 0));
    } // latest / popular は findMany の orderBy を利用済み

    const total = scored.length;
    const offset = (page - 1) * take;
    const items = scored.slice(offset, offset + take);

    return NextResponse.json(
      {
        ok: true,
        meta: {
          range,
          shorts,
          sort,
          page,
          take,
          total,
          ...(debug
            ? {
                debug: {
                  where,
                  pool: pool.length,
                  from: from.toISOString(),
                },
              }
            : {}),
        },
        items,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
