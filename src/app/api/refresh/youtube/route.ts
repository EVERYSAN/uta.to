// src/app/api/refresh/youtube/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchRecentYouTube } from "@/lib/youtube";

// （任意）Vercelで動的実行にする
export const dynamic = "force-dynamic";

function parseIntSafe(v: string | null, def: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const hours = parseIntSafe(url.searchParams.get("hours"), 24);
    const limit = parseIntSafe(url.searchParams.get("limit"), 200);
    const query = url.searchParams.get("query") ?? undefined;

    // fetchRecentYouTube は RawVideo[] または { items: RawVideo[] } を返し得る
    const raw = (await fetchRecentYouTube({ hours, limit, query } as any)) as
      | any[]
      | { items?: any[] };
    const list = Array.isArray(raw) ? raw : raw?.items ?? [];

    let fetched = list.length;
    let upserts = 0;
    let skippedNoId = 0;

    for (const it of list) {
      const platform = "youtube";
      // いまの型では platformVideoId は直接は無い想定。id を優先、無ければ空文字
      const platformVideoId: string =
        (it as any).platformVideoId ??
        (it as any)?.contentDetails?.videoId ??
        (it as any).id ??
        "";

      if (!platformVideoId) {
        skippedNoId++;
        continue;
      }

      // 必須フィールドはここで確定（fallback あり）
      const publishedAtStr: string | undefined = (it as any).publishedAt;
      const publishedAt = publishedAtStr ? new Date(publishedAtStr) : new Date();

      const title: string = (it as any).title ?? `video ${platformVideoId}`;
      const urlStr: string =
        (it as any).url ??
        `https://www.youtube.com/watch?v=${platformVideoId}`;

      // 任意フィールドは undefined を渡さない（存在するものだけ spread）
      const thumbnailUrl: string | undefined = (it as any).thumbnailUrl;
      const durationSec: number | undefined = (it as any).durationSec;
      const channelTitle: string | undefined = (it as any).channelTitle;
      const views: number | undefined = (it as any).views;
      const likes: number | undefined = (it as any).likes;

      const createData: Parameters<typeof prisma.video.upsert>[0]["create"] = {
        platform,
        platformVideoId,
        title,
        url: urlStr,
        publishedAt,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(typeof durationSec === "number" ? { durationSec } : {}),
        ...(channelTitle ? { channelTitle } : {}),
        ...(typeof views === "number" ? { views } : {}),
        ...(typeof likes === "number" ? { likes } : {}),
      };

      const updateData: Parameters<typeof prisma.video.upsert>[0]["update"] = {
        title,
        url: urlStr,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(typeof durationSec === "number" ? { durationSec } : {}),
        ...(channelTitle ? { channelTitle } : {}),
        ...(typeof views === "number" ? { views } : {}),
        ...(typeof likes === "number" ? { likes } : {}),
        ...(publishedAtStr ? { publishedAt } : {}), // 公開日時が取れたときのみ上書き
      };

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
      requested: fetched,
      upserts,
      skippedNoId,
    });
  } catch (err: any) {
    console.error("refresh/youtube error", err);
    return NextResponse.json(
      { ok: false, route: "refresh/youtube", error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
