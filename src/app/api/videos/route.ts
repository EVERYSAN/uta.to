// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Range = "24h" | "7d" | "30d";
type Shorts = "any" | "only" | "exclude" | "long";
type Sort = "trending" | "support" | "latest" | "popular";

function parseParams(url: URL) {
  const range = (url.searchParams.get("range") as Range) || "24h";
  const shorts = (url.searchParams.get("shorts") as Shorts) || "any";
  const sort = (url.searchParams.get("sort") as Sort) || "trending";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const take = Math.min(60, Math.max(1, Number(url.searchParams.get("take") ?? "24")));

  const now = new Date();
  const from = new Date(now);
  if (range === "24h") from.setHours(now.getHours() - 24);
  else if (range === "7d") from.setDate(now.getDate() - 7);
  else if (range === "30d") from.setDate(now.getDate() - 30);

  return { range, shorts, sort, page, take, from };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { shorts, sort, page, take, from } = parseParams(url);

    // where 句（スキーマ互換のみ使用）
    const where: any = {
      publishedAt: { gte: from },
    };

    // shorts フィルタ（url の null 判定などは使わない）
    if (shorts === "only") {
      where.durationSec = { lte: 60 };
    } else if (shorts === "exclude" || shorts === "long") {
      // 仕様: 61秒以上をロング
      where.durationSec = { gte: 61 };
    }
    const skip = (page - 1) * take;

    // 並び替えの既定（急上昇以外は DB 並び替え）
    let orderBy: any = undefined;
    if (sort === "latest") orderBy = { publishedAt: "desc" };
    else if (sort === "popular") orderBy = { views: "desc" };
    else if (sort === "support") orderBy = { likes: "desc" };

    // 返すフィールド
    const select = {
      id: true,
      title: true,
      thumbnailUrl: true,
      channelTitle: true,
      publishedAt: true,
      durationSec: true,
      views: true,
      likes: true,
      url: true,
    };

    // 急上昇のみアプリ側でスコア計算
    if (sort === "trending") {
      const poolSize = Math.max(take * 6, 120); // 少し多めに候補を取る
      const pool = await prisma.video.findMany({
        where,
        orderBy: { publishedAt: "desc" }, // 新しい順に候補
        take: poolSize,
        select,
      });

      const now = Date.now();
      const scored = pool.map((v) => {
        const ageHours = Math.max(1, (now - new Date(v.publishedAt).getTime()) / 3600000);
        // 応援データが無くても動く簡易スコア
        const base = (v.likes ?? 0) + (v.views ?? 0) / 50;
        const trendScore = base / Math.pow(ageHours / 24, 0.35); // ゆるやか減衰
        return { ...v, trendScore };
      });

      scored.sort((a, b) => b.trendScore - a.trendScore);
      const items = scored.slice(skip, skip + take);
      return NextResponse.json({
        ok: true,
        meta: { page, take, total: scored.length, sort: "trending" },
        items,
      });
    }

    // それ以外は DB 側で並び替え
    const [total, items] = await Promise.all([
      prisma.video.count({ where }),
      prisma.video.findMany({ where, orderBy, skip, take, select }),
    ]);

    return NextResponse.json({
      ok: true,
      meta: { page, take, total, sort },
      items,
    });
  } catch (e: any) {
    console.error("[/api/videos] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Internal Error" },
      { status: 500 }
    );
  }
}
