// src/app/api/refresh/youtube/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Prisma を使うので Edge ではなく Node.js で実行
export const runtime = "nodejs";

// 環境変数名はどちらでも拾えるように
const YT_KEY =
  process.env.YT_API_KEY ||
  process.env.YOUTUBE_API_KEY ||
  process.env.NEXT_PUBLIC_YT_API_KEY ||
  "";

type YtSearchItem = {
  id?: { videoId?: string } | string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
  };
};

export async function GET(req: Request) {
  const url = new URL(req.url);

  // デフォルト：直近6時間、最大 32 件、クエリ未指定
  const hours = Math.max(1, Math.min(48, Number(url.searchParams.get("hours")) || 6));
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 32));
  const query = (url.searchParams.get("query") || process.env.YT_DEFAULT_QUERY || "").trim();

  if (!YT_KEY) {
    // 500 を返さず 200 + ok:false で返す
    return NextResponse.json(
      { ok: false, route: "refresh/youtube", error: "Missing YT_API_KEY (or YOUTUBE_API_KEY)" },
      { status: 200 }
    );
  }

  const publishedAfter = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  // YouTube Data API: search.list
  const params = new URLSearchParams({
    key: YT_KEY,
    part: "snippet",
    type: "video",
    order: "date",
    maxResults: String(limit),
    publishedAfter,
    // q は空の時に付けない（空文字は 400 の原因になりがち）
  });

  if (query) {
    params.set("q", query);
  } else {
    // クエリが無い時は「音楽カテゴリ」に絞る（Music = 10）
    params.set("videoCategoryId", "10");
    // 地域を指定したい場合は環境変数で
    if (process.env.YT_REGION_CODE) params.set("regionCode", process.env.YT_REGION_CODE);
  }

  const apiUrl = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

  try {
    const res = await fetch(apiUrl, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // ここで 500 にせず、内容を返す
      return NextResponse.json(
        {
          ok: false,
          route: "refresh/youtube",
          status: res.status,
          error: `YouTube search failed: ${res.status}`,
          detail: text.slice(0, 500),
        },
        { status: 200 }
      );
    }

    const json: { items?: YtSearchItem[] } = await res.json();
    const items = json.items ?? [];

    // 取り出し & Upsert
    let upserts = 0;
    for (const it of items) {
      const videoId =
        typeof it.id === "string"
          ? it.id
          : it.id?.videoId || ""; // search は id.videoId
      if (!videoId) continue;

      const title = it.snippet?.title || `video ${videoId}`;
      const channelTitle = it.snippet?.channelTitle || undefined;
      const publishedAt = it.snippet?.publishedAt ? new Date(it.snippet!.publishedAt!) : undefined;
      const thumb =
        it.snippet?.thumbnails?.high?.url ||
        it.snippet?.thumbnails?.medium?.url ||
        undefined;

      const url = `https://www.youtube.com/watch?v=${videoId}`;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform: "youtube", platformVideoId: videoId } },
        create: {
          platform: "youtube",
          platformVideoId: videoId,
          title,
          channelTitle,
          publishedAt,
          thumbnailUrl: thumb,
          url,
        },
        update: {
          title,
          channelTitle,
          publishedAt,
          thumbnailUrl: thumb,
          url,
        },
      });

      upserts++;
    }

    return NextResponse.json({
      ok: true,
      route: "refresh/youtube",
      fetched: items.length,
      upserts,
      hours,
      limit,
      usedQuery: query || null,
    });
  } catch (e: any) {
    // 例外でも 200 で返す（スナップショット全体が落ちないように）
    return NextResponse.json(
      {
        ok: false,
        route: "refresh/youtube",
        error: e?.message || String(e),
      },
      { status: 200 }
    );
  }
}
