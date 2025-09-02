import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const prisma = new PrismaClient();

type Range = "24h" | "7d" | "30d";
type Sort = "trending" | "views" | "likes";

const hoursOf = (r: Range) => (r === "7d" ? 7 * 24 : r === "30d" ? 30 * 24 : 24);

export async function GET(req: Request) {
  const url = new URL(req.url);

  // --- パラメータ（互換性のため両取り） ---
  const range = (["24h", "7d", "30d"].includes(url.searchParams.get("range") || "")
    ? (url.searchParams.get("range") as Range)
    : "24h");

  // shorts=exclude も excludeShorts=true/1 も受ける
  const shortsParam = (url.searchParams.get("shorts") || "").toLowerCase();
  const excludeShortsFlag =
    shortsParam === "exclude" ||
    /^(1|true|yes)$/i.test(url.searchParams.get("excludeShorts") || "");

  const sort = (["trending", "views", "likes"].includes(url.searchParams.get("sort") || "")
    ? (url.searchParams.get("sort") as Sort)
    : "trending");

  const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1);
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || "24") || 24));

  // --- 厳密ローリング窓（UTC） ---
  const now = Date.now();
  const since = new Date(now - hoursOf(range) * 3600_000);

  // --- WHERE（ショート除外ロジックを堅牢化） ---
  // ポイント：
  //  - durationSec は「取得済みかつ >0 のときだけ」短尺判定に使う
  //  - URL / platformVideoId に '/shorts/' を含むものは短尺扱い
  const baseWhere: any = {
    platform: "youtube",
    publishedAt: { gte: since },
  };

  const excludeShortsWhere = excludeShortsFlag
    ? {
        NOT: {
          OR: [
            // durationSec が取得済み（>0）の場合のみ 60秒以下を短尺とみなす
            { AND: [{ durationSec: { gt: 0 } }, { durationSec: { lte: 60 } }] },
            { url: { contains: "/shorts/" } },
            { platformVideoId: { contains: "/shorts/" } },
          ],
        },
      }
    : {};

  const where = { AND: [baseWhere, excludeShortsWhere] };

  // --- 取得（views desc で多め） ---
  const rows = await prisma.video.findMany({
    where,
    orderBy: [{ views: "desc" }],
    take: take * 2,
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
    },
  });

  // --- トレンドスコア（軽量） ---
  const scored = rows.map((v) => {
    const views = Number(v.views || 0);
    const likes = Number(v.likes || 0);
    const published = v.publishedAt ? new Date(v.publishedAt).getTime() : now;
    const ageHours = Math.max(0, (now - published) / 3600_000);
    const trendingScore = (views + 4 * likes) / Math.pow(ageHours + 2, 1.3);
    return { ...v, trendingScore };
  });

  if (sort === "views") {
    scored.sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
  } else if (sort === "likes") {
    scored.sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0));
  } else {
    scored.sort((a, b) => (b.trendingScore! - a.trendingScore!));
  }
  scored.forEach((v, i) => ((v as any).trendingRank = i + 1));

  // --- ページング ---
  const start = (page - 1) * take;
  const items = scored.slice(start, start + take);

  // --- レスポンス ---
  return NextResponse.json(
    {
      ok: true,
      items,
      page,
      take,
      total: scored.length,
      window: { range, since: since.toISOString() },
      params: {
        excludeShorts: excludeShortsFlag,
      },
    },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0" } }
  );
}
