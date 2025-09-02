// src/app/api/refresh/youtube/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

// ※ Vercel環境だと複数インスタンス化を避けるためのガード
const globalForPrisma = global as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["error", "warn"] });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const YT_API_KEY = process.env.YT_API_KEY; // ← env 名は YT_API_KEY で統一

type YtItem = {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
      maxres?: { url?: string };
    };
  };
  contentDetails?: {
    duration?: string; // ISO8601 PT#H#M#S
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
};

function parseISODurationToSec(iso?: string): number | undefined {
  if (!iso) return undefined;
  // 例: PT1H2M3S, PT4M10S, PT55S, PT2H
  const m = iso.match(
    /P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i
  );
  if (!m) return undefined;
  const [, d, h, min, s] = m.map((v) => (v ? parseInt(v, 10) : 0));
  return (d || 0) * 86400 + (h || 0) * 3600 + (min || 0) * 60 + (s || 0);
}

function pickThumb(s?: YtItem["snippet"]) {
  return (
    s?.thumbnails?.maxres?.url ||
    s?.thumbnails?.high?.url ||
    s?.thumbnails?.medium?.url ||
    s?.thumbnails?.default?.url
  );
}

async function fetchYoutubeDetails(ids: string[]): Promise<YtItem[]> {
  if (!YT_API_KEY) {
    throw new Error("YT_API_KEY is not set");
  }
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails,statistics");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", YT_API_KEY);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YouTube API error: ${res.status} ${text}`);
  }
  const json = await res.json();
  return Array.isArray(json?.items) ? (json.items as YtItem[]) : [];
}

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams;
    const idsParam = search.get("ids");
    if (!idsParam) {
      return NextResponse.json({ ok: false, error: "required: ids" }, { status: 400 });
    }

    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "ids: empty" }, { status: 400 });
    }

    // YouTube 詳細取得
    const items = await fetchYoutubeDetails(ids);

    let upserts = 0;
    for (const it of items) {
      const platform = "youtube" as const;
      const platformVideoId = it.id;

      // 必須は安全に文字列へ
      const safeTitle =
        (it.snippet?.title ?? "").trim() || `video ${platformVideoId}`;
      const safeUrl = `https://www.youtube.com/watch?v=${platformVideoId}`;
      const safeThumb =
        pickThumb(it.snippet) ||
        `https://i.ytimg.com/vi/${platformVideoId}/hqdefault.jpg`;

      // 任意項目は「ある時だけ」入れる
      const pubAt = it.snippet?.publishedAt
        ? new Date(it.snippet.publishedAt)
        : undefined;
      const durationSec = parseISODurationToSec(it.contentDetails?.duration);
      const channelTitle = it.snippet?.channelTitle?.trim() || undefined;
      const views =
        it.statistics?.viewCount != null
          ? Number(it.statistics.viewCount)
          : undefined;
      const likes =
        it.statistics?.likeCount != null
          ? Number(it.statistics.likeCount)
          : undefined;

      // Update 用：存在すれば更新。Prisma.VideoUpdateInput はプリミティブでOK
      const updateData: Prisma.VideoUpdateInput = {
        title: safeTitle,
        url: safeUrl,
        thumbnailUrl: safeThumb,
        ...(pubAt ? { publishedAt: pubAt } : {}),
        ...(durationSec != null ? { durationSec } : {}),
        ...(channelTitle ? { channelTitle } : {}),
        ...(views != null ? { views } : {}),
        ...(likes != null ? { likes } : {}),
      };

      // Create 用：必須フィールドは **必ず** 与える。任意項目は defined の時だけ追加。
      // ここで UpdateInput を流用しないのがポイント（型衝突を避ける）
      const createData: Prisma.VideoCreateInput = {
        platform,
        platformVideoId,
        title: safeTitle,
        url: safeUrl,
        thumbnailUrl: safeThumb,
        ...(pubAt ? { publishedAt: pubAt } : {}),
        ...(durationSec != null ? { durationSec } : {}),
        ...(channelTitle ? { channelTitle } : {}),
        ...(views != null ? { views } : {}),
        ...(likes != null ? { likes } : {}),
      };

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        create: createData,
        update: updateData,
      });

      upserts += 1;
    }

    return NextResponse.json({
      ok: true,
      requested: ids.length,
      fetched: items.length,
      upserts,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
