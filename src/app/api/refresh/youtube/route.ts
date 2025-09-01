// src/app/api/refresh/youtube/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { fetchDetails } from "@/lib/youtube";
import type { NextRequest } from "next/server";

const prisma = new PrismaClient();

// 例:
// /api/refresh/youtube?onlyMissing=1&take=500
function isAuthorized(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("secret");
  const h = req.headers.get("x-cron-secret");
  if (q && q === process.env.CRON_SECRET) return true;
  if (h && h === process.env.CRON_SECRET) return true;
  if (req.headers.get("x-vercel-cron") === "1") return true;
  return false;
};
// /api/refresh/youtube?sinceHours=48&take=1000
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const onlyMissing = (searchParams.get("onlyMissing") ?? "0") === "1";
  const sinceHours = Number(searchParams.get("sinceHours") ?? "0");
  const take = Math.min(Number(searchParams.get("take") ?? "200"), 2000);

  const whereBase: any = { platform: "youtube" };

  let where = whereBase;
  if (onlyMissing) {
    // 0 を“未取得相当”として更新
    where = {
      ...whereBase,
      OR: [{ views: 0 }, { likes: 0 }, { channelTitle: "" }],
    };
  } else if (sinceHours > 0) {
    const gte = new Date(Date.now() - sinceHours * 3600 * 1000);
    where = { ...whereBase, publishedAt: { gte } };
  }

  const rows = await prisma.video.findMany({
    where,
    select: { platformVideoId: true },
    orderBy: { publishedAt: "desc" },
    take,
  });

  const ids = rows.map((r) => r.platformVideoId);
  const details = await fetchDetails(ids);

  let updated = 0;
  for (const v of details) {
    await prisma.video.update({
      where: { platform_platformVideoId: { platform: "youtube", platformVideoId: v.id } },
      data: {
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        channelTitle: v.channelTitle,
        durationSec: v.durationSec,
        publishedAt: v.publishedAt, // まれに変わることがある
        views: v.views,
        likes: v.likes,
      },
    }).then(() => updated++)
      .catch((e) => console.error("[refresh] update error", v.id, e));
  }

  return NextResponse.json({
    ok: true,
    targetCount: ids.length,
    updated,
    onlyMissing,
    sinceHours: sinceHours || undefined,
  });
}
