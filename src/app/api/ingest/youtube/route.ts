// src/app/api/ingest/youtube/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { searchPages, fetchDetails } from "@/lib/youtube";

const prisma = new PrismaClient();

// 例: /api/ingest/youtube?q=歌ってみた&maxPages=80&publishedAfter=2025-08-28T00:00:00Z&dryRun=1
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "歌ってみた";
  const maxPages = Math.min( Number(searchParams.get("maxPages") ?? "80"), 200 ); // 保険
  const publishedAfter = searchParams.get("publishedAfter") ?? undefined;
  const dryRun = (searchParams.get("dryRun") ?? "0") === "1";

  const ids = await searchPages({ q, maxPages, publishedAfter });
  const details = await fetchDetails(ids);

  let created = 0, updated = 0;

  if (!dryRun) {
    // Prisma の複合ユニーク: @@unique([platform, platformVideoId]) が前提
    for (const v of details) {
      const where = { platform_platformVideoId: { platform: "youtube", platformVideoId: v.id } };
      const data = {
        platform: "youtube" as const,
        platformVideoId: v.id,
        title: v.title,
        url: v.url,
        thumbnailUrl: v.thumbnailUrl,
        channelTitle: v.channelTitle,
        publishedAt: v.publishedAt,
        durationSec: v.durationSec,
        views: v.views,
        likes: v.likes,
      };

      await prisma.video.upsert({
        where,
        create: data,
        update: {
          // 新着は create、既存はメタを更新（タイトル等が変わることがある）
          title: data.title,
          thumbnailUrl: data.thumbnailUrl,
          channelTitle: data.channelTitle,
          publishedAt: data.publishedAt,
          durationSec: data.durationSec,
          views: data.views,
          likes: data.likes,
        },
      }).then((row) => {
        row.createdAt ? created++ : updated++;
      }).catch((e) => {
        // 取り込みは続行
        console.error("[ingest] upsert error", v.id, e);
      });
    }
  }

  return NextResponse.json({
    ok: true,
    q,
    maxPages,
    publishedAfter,
    foundIds: ids.length,
    detailed: details.length,
    created,
    updated,
    dryRun,
  });
}
