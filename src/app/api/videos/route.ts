// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

type Range = "1d" | "7d" | "30d";
type Shorts = "all" | "exclude";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const range = (url.searchParams.get("range") as Range) || "1d";
  const shorts = (url.searchParams.get("shorts") as Shorts) || "all";
  const sort = url.searchParams.get("sort") || "trending";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const take = Math.min(50, Math.max(1, Number(url.searchParams.get("take") || 24)));
  const skip = (page - 1) * take;

  // 集計対象期間
  const since =
    range === "7d"
      ? dayjs().subtract(7, "day").toDate()
      : range === "30d"
      ? dayjs().subtract(30, "day").toDate()
      : dayjs().subtract(1, "day").toDate();

  // shorts 除外フィルタ（60秒以下 or /shorts/ を除外）
  const where: any = {
    platform: { equals: "youtube", mode: "insensitive" },
  };
  if (shorts === "exclude") {
    where.OR = [
      { durationSec: null },
      { durationSec: { gt: 60 } },
      { url: { not: { contains: "/shorts/" } } },
    ];
  }

  // 一覧取得（並びはお好みで。とりあえず新しい順）
  const videos = await prisma.video.findMany({
    where,
    orderBy:
      sort === "latest"
        ? { publishedAt: "desc" }
        : sort === "views"
        ? { views: "desc" }
        : { publishedAt: "desc" }, // "trending" などはここに必要なら追加
    skip,
    take,
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
      views: true,
      likes: true,
      supportPoints: true, // 古いフィールド（あるなら併記）
    },
  });

  // 直近期間の応援合計を videoId ごとに集計
  const sums = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: {
      createdAt: { gte: since },
      videoId: { in: videos.map((v) => v.id) },
    },
    _sum: { amount: true },
  });
  const supportMap = new Map(sums.map((g) => [g.videoId, g._sum.amount ?? 0]));

  const items = videos.map((v) => ({
    ...v,
    // 一覧カードで使えるフィールド名に統一
    support24h: supportMap.get(v.id) ?? 0,
  }));

  return NextResponse.json(
    { ok: true, items },
    { headers: { "Cache-Control": "no-store" } }
  );
}
