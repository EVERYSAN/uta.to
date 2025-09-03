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

    const where: any = {
      publishedAt: { gte: from },
    };

    // 60秒以下=ショート、61秒以上=ロング
    if (shorts === "only") {
      where.durationSec = { lte: 60 };
    } else if (shorts === "exclude" || shorts === "long") {
      where.durationSec = { gte: 61 };
    }

    const skip = (page - 1) * take;

    let orderBy: any = undefined;
    if (sort === "latest") orderBy = { publishedAt: "desc" };
    else if (sort === "popular") orderBy = { views: "desc" };
    else if (sort === "support") orderBy = { likes: "desc" };

    const select = {
      id: true,
      title: true,
      thumbnailUrl: true,
      channelTitle: true,
      publishedAt: true, // Date | null
      durationSec: true,
      views: true,
      likes: true,
      url: true,
    };

    // 急上昇はアプリ側スコア
    if (sort === "trending") {
      const poolSize = Math.max(take * 6, 120);
      const pool = await prisma.video.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        take: poolSize,
        select,
      });

      const nowMs = Date.now();

      const scored = pool.map((v) => {
        // ▼ 修正ポイント: null セーフに変換
        const publishedMs = v.publishedAt
          ? new Date(v.publishedAt).getTime()
          : 0; // null のときは「とても古い」扱い
        const ageHours = Math.max(1, (nowMs - publishedMs) / 3_600_000);

        const base = (v.likes ?? 0) + (v.views ?? 0) / 50;
        const trendScore = base / Math.pow(ageHours / 24, 0.35); // 緩やか減衰
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

    // それ以外は DB 並び替え
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
