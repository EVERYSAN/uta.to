// src/app/api/refresh/youtube/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { fetchRecentYouTube, type RawVideo } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

// URLからYouTubeのvideoIdをフォールバック抽出（もしidが無い場合の保険）
function extractYouTubeIdFromUrl(url?: string | null): string | "" {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      return v ?? "";
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.replace("/", "");
    }
  } catch {
    // noop
  }
  return "";
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const hours = Number(searchParams.get("hours") ?? "24");
    const limit = Number(searchParams.get("limit") ?? "100");
    const query = searchParams.get("query") ?? undefined;

    // YouTubeから最近の動画候補を取得（RawVideo[]）
    const list: RawVideo[] = await fetchRecentYouTube({ hours, limit, query });

    let fetched = list.length;
    let upserts = 0;
    let skippedNoId = 0;

    for (const it of list) {
      const platform = "youtube" as const;

      // RawVideo は id を持つ前提。なければURLから抽出を試みる
      const platformVideoId =
        it.id || extractYouTubeIdFromUrl(it.url) || "";

      if (!platformVideoId) {
        skippedNoId++;
        continue;
      }

      // Prisma の create 側は undefined を許さないので、必須は安全なフォールバックを用意
      const safeTitle = it.title ?? `video ${platformVideoId}`;
      const safeUrl =
        it.url ?? `https://www.youtube.com/watch?v=${platformVideoId}`;
      const safePublishedAt = new Date(
        it.publishedAt ?? Date.now() // schemaが必須でも通るように現在時刻でフォールバック
      );

      // ---- create 用（必須フィールドは確実に埋める）----
      const createData: Prisma.VideoUncheckedCreateInput = {
        platform,
        platformVideoId,
        title: safeTitle,
        url: safeUrl,
        publishedAt: safePublishedAt,
      };
      // 任意項目は「あるときだけ」足す（undefinedを入れない）
      if (it.thumbnailUrl) createData.thumbnailUrl = it.thumbnailUrl;
      if (typeof it.durationSec === "number")
        createData.durationSec = it.durationSec;
      if (typeof it.views === "number") createData.views = it.views;
      if (typeof it.likes === "number") createData.likes = it.likes;
      if (it.channelTitle) createData.channelTitle = it.channelTitle;

      // ---- update 用（変わり得る項目のみ）----
      const updateData: Prisma.VideoUncheckedUpdateInput = {
        title: safeTitle,
        url: safeUrl,
      };
      if (it.thumbnailUrl) updateData.thumbnailUrl = it.thumbnailUrl;
      if (typeof it.durationSec === "number")
        updateData.durationSec = it.durationSec;
      if (typeof it.views === "number") updateData.views = it.views;
      if (typeof it.likes === "number") updateData.likes = it.likes;
      if (it.channelTitle) updateData.channelTitle = it.channelTitle;
      if (it.publishedAt) updateData.publishedAt = new Date(it.publishedAt);

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        create: createData,
        update: updateData,
      });

      upserts++;
    }

    return NextResponse.json({
      ok: true,
      route: "refresh/youtube",
      params: { hours, limit, query },
      fetched,
      upserts,
      skippedNoId,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { ok: false, route: "refresh/youtube", error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
