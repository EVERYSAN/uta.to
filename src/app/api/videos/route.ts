// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// ---- helpers -------------------------------------------------

type Range = "24h" | "7d" | "30d";
type Shorts = "any" | "only" | "exclude";
type Sort = "trending" | "latest" | "popular" | "support"; // supportはpopularにフォールバック

function parseRange(v: string | undefined): Range {
  return v === "7d" || v === "30d" ? v : "24h";
}
function parseShorts(v: string | undefined): Shorts {
  return v === "only" || v === "exclude" ? v : "any";
}
function parseSort(v: string | undefined): Sort {
  return v === "latest" || v === "popular" || v === "support" ? v : "trending";
}
function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3600_000);
}
function rangeToFrom(range: Range) {
  if (range === "7d") return hoursAgo(24 * 7);
  if (range === "30d") return hoursAgo(24 * 30);
  return hoursAgo(24);
}

// Prisma の where を組み立て（ショート/ロング）
function shortsWhere(shorts: Shorts): Prisma.VideoWhereInput | undefined {
  if (shorts === "any") return undefined;

  if (shorts === "only") {
    // 「/shorts/」または 60 秒以下をショート扱い
    return {
      OR: [
        { url: { contains: "/shorts/" } },
        { durationSec: { lte: 60 } }, // null は含まれない
      ],
    };
  }

  // exclude = ロングのみ
  // 「/shorts/」を含まず、(durationSec >=61) または (durationSec が null)
  return {
    AND: [
      { url: { not: { contains: "/shorts/" } } },
      {
        OR: [{ durationSec: { gte: 61 } }, { durationSec: { equals: null } }],
      },
    ],
  };
}

// ---- GET -----------------------------------------------------

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const range = parseRange(searchParams.get("range") || undefined);
    const shorts = parseShorts(searchParams.get("shorts") || undefined);
    const sort = parseSort(searchParams.get("sort") || undefined);
    const page = Math.max(1, Number(searchParams.get("page") || "1"));
    const take = Math.min(50, Math.max(1, Number(searchParams.get("take") || "24")));
    const offset = (page - 1) * take;

    const from = rangeToFrom(range);
    const baseWhere: Prisma.VideoWhereInput = {
      publishedAt: { gte: from }, // null は除外される（期間比較できないため）
      ...(shortsWhere(shorts) ?? {}),
    };

    // ---- 早いソートはDB側で ----
    if (sort === "latest") {
      const [items, total] = await Promise.all([
        prisma.video.findMany({
          where: baseWhere,
          orderBy: { publishedAt: "desc" },
          take,
          skip: offset,
          select: {
            id: true,
            title: true,
            channelTitle: true,
            url: true,
            thumbnailUrl: true, // ← thumbnail ではなく thumbnailUrl
            durationSec: true,
            publishedAt: true,
            views: true,
            likes: true,
          },
        }),
        prisma.video.count({ where: baseWhere }),
      ]);
      return NextResponse.json({
        ok: true,
        meta: { range, shorts, sort, page, take, total },
        items,
      });
    }

    if (sort === "popular" || sort === "support") {
      const [items, total] = await Promise.all([
        prisma.video.findMany({
          where: baseWhere,
          orderBy: [{ views: "desc" }, { likes: "desc" }, { publishedAt: "desc" }],
          take,
          skip: offset,
          select: {
            id: true,
            title: true,
            channelTitle: true,
            url: true,
            thumbnailUrl: true,
            durationSec: true,
            publishedAt: true,
            views: true,
            likes: true,
          },
        }),
        prisma.video.count({ where: baseWhere }),
      ]);
      return NextResponse.json({
        ok: true,
        meta: { range, shorts, sort, page, take, total },
        items,
      });
    }

    // ---- trending は軽く計算して整列（DB 200 件くらいから）----
    const poolSize = Math.max(take * 4, 120);
    const pool = await prisma.video.findMany({
      where: baseWhere,
      orderBy: { publishedAt: "desc" },
      take: poolSize,
      select: {
        id: true,
        title: true,
        channelTitle: true,
        url: true,
        thumbnailUrl: true,
        durationSec: true,
        publishedAt: true, // Date | null
        views: true,
        likes: true,
      },
    });

    const now = Date.now();
    const scored = pool.map((v) => {
      const publishedAtMs = v.publishedAt ? new Date(v.publishedAt).getTime() : now; // null ガード
      const ageHours = Math.max(1, (now - publishedAtMs) / 3600_000);

      // 応援テーブルがなくても成立する簡易スコア
      const base = (v.likes ?? 0) + (v.views ?? 0) / 50;
      let trend = base / Math.pow(ageHours / 24, 0.35);

      // ロング(>=61s) に微ブースト
      if ((v.durationSec ?? 0) >= 61) trend *= 1.04;

      return { ...v, _score: trend };
    });

    scored.sort((a, b) => b._score - a._score);
    const total = scored.length;
    const pageItems = scored.slice(offset, offset + take).map(({ _score, ...rest }) => rest);

    // デバッグ用: ?debug=1 で where等を返す（ステータス200のまま）
    const debug = searchParams.get("debug") ? {
      where: baseWhere,
      pool: pool.length,
      from,
    } : undefined;

    return NextResponse.json({
      ok: true,
      meta: { range, shorts, sort, page, take, total, debug },
      items: pageItems,
    });
  } catch (err: any) {
    // 500 を返すとフロントが何も見えないので、200でエラー内容を返す
    console.error("[/api/videos] error", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 200 }
    );
  }
}
