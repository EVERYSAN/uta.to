// src/app/api/support/ranking/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 例: range=24h|7d|30d（デフォルト7d）
function parseRangeToHours(range?: string) {
  switch (range) {
    case "24h":
      return 24;
    case "30d":
      return 30 * 24;
    case "7d":
    default:
      return 7 * 24;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rangeParam = url.searchParams.get("range") ?? "7d";
    const hours = parseRangeToHours(rangeParam);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // ① SupportEvent を期間内で集計
    const groups = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where: { createdAt: { gte: since } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 50,
    });

    if (groups.length === 0) {
      return NextResponse.json({
        ok: true,
        range: rangeParam,
        since: since.toISOString(),
        total: 0,
        items: [],
      });
    }

    // ② 対象の Video 情報を取得
    const ids = groups.map((g) => g.videoId);
    const videos = await prisma.video.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        url: true,
        thumbnailUrl: true,
        views: true,
        likes: true,
        publishedAt: true,
      },
    });
    const vmap = new Map(videos.map((v) => [v.id, v]));

    // ③ 集計値（supportPoints相当）を付けて並べ替えで返す
    const items = groups
      .map((g) => {
        const v = vmap.get(g.videoId);
        if (!v) return null;
        return {
          ...v,
          supportPoints: g._sum.amount ?? 0, // ← 計算で作る
        };
      })
      .filter(Boolean) as Array<
      typeof videos[number] & { supportPoints: number }
    >;

    return NextResponse.json({
      ok: true,
      range: rangeParam,
      since: since.toISOString(),
      total: items.length,
      items,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
