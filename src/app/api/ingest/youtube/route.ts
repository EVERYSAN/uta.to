import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * YouTube から「歌ってみた」を収集して Video テーブルに upsert
 *
 * GET /api/ingest/youtube?hours=6&pages=2&q=歌ってみた&dry=1
 *  - hours: 何時間分の新着を対象 (default 6)
 *  - pages: 何ページ分取るか (default 2, 1ページ=最大50件)
 *  - q:     検索語。未指定なら「歌ってみた」
 *  - dry=1: DBに書かず件数だけ返す
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const hours = Math.max(1, Number(url.searchParams.get("hours") || 6));
    const pages = Math.max(1, Math.min(5, Number(url.searchParams.get("pages") || 2)));
    const q = (url.searchParams.get("q") || "歌ってみた").trim();
    const dryRun = url.searchParams.get("dry") === "1";

    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      return NextResponse.json({ ok: false, error: "YOUTUBE_API_KEY is missing" }, { status: 500 });
    }

    const publishedAfter = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // 1) search.list で videoId を収集
    let scanned = 0;
    let videoIds: string[] = [];
    let pageToken: string | undefined = undefined;

    for (let i = 0; i < pages; i++) {
      const params = new URLSearchParams({
        key,
        part: "snippet",
        type: "video",
        q,
        order: "date",
        maxResults: "50",
        publishedAfter,
      });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(
        "https://www.googleapis.com/youtube/v3/search?" + params.toString(),
        { headers: { Accept: "application/json" }, cache: "no-store" }
      );
      if (!res.ok) throw new Error(`YouTube search API ${res.status}`);

      const json = await res.json();
      const ids: string[] =
        (json.items as any[] | undefined)?.map((it) => it?.id?.videoId).filter(Boolean) ?? [];

      scanned += ids.length;
      videoIds = videoIds.concat(ids);

      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }

    // 2) videos.list で詳細を取得
    let details: any[] = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const chunk = videoIds.slice(i, i + 50);
      const params = new URLSearchParams({
        key,
        part: "contentDetails,statistics,snippet",
        id: chunk.join(","),
        maxResults: "50",
      });
      const res = await fetch(
        "https://www.googleapis.com/youtube/v3/videos?" + params.toString(),
        { headers: { Accept: "application/json" }, cache: "no-store" }
      );
      if (!res.ok) throw new Error(`YouTube videos API ${res.status}`);
      const json = await res.json();
      details = details.concat(json.items ?? []);
    }

    if (dryRun) {
      return NextResponse.json({ ok: true, dr: true, scanned, items: details.length });
    }

    // ISO8601 → 秒
    const toSec = (iso?: string) => {
      if (!iso) return null;
      const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!m) return null;
      const h = parseInt(m[1] ?? "0", 10);
      const mi = parseInt(m[2] ?? "0", 10);
      const s = parseInt(m[3] ?? "0", 10);
      return h * 3600 + mi * 60 + s;
    };

    // 3) DB に upsert（Video には汎用項目のみ保存）
    let upserts = 0;
    let snapshots = 0;
    const platform = "youtube";

    for (const v of details) {
      const id = v?.id as string | undefined;
      const sn = v?.snippet;
      if (!id || !sn) continue;

      const title = sn.title ?? "";
      const description = sn.description ?? "";
      const publishedAt = sn.publishedAt ? new Date(sn.publishedAt) : new Date();
      const channelTitle = sn.channelTitle ?? "";
      const thumbnailUrl =
        sn.thumbnails?.maxres?.url ||
        sn.thumbnails?.standard?.url ||
        sn.thumbnails?.high?.url ||
        sn.thumbnails?.medium?.url ||
        sn.thumbnails?.default?.url ||
        null;

      const durationSec = toSec(v?.contentDetails?.duration);

      // ※ Video に views/likes を書かない（スキーマに無い前提）
      const videoData: any = {
        title,
        description,
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl,
        publishedAt,
        durationSec,
        channelTitle,
      };

      // upsert（複合ユニーク where）
      const video = await prisma.video.upsert({
        where: {
          platform_platformVideoId: {
            platform,
            platformVideoId: id,
          },
        },
        create: {
          ...videoData,
          platform,
          platformVideoId: id,
        } as any,
        update: {
          ...videoData,
        } as any,
      });

      upserts++;

      // 可能なら StatsSnapshot にも保存（存在しなければ何もしない）
      try {
        const views = Number(v?.statistics?.viewCount ?? 0);
        const likes = Number(v?.statistics?.likeCount ?? 0);
        const statsClient: any = (prisma as any).statsSnapshot;
        if (statsClient?.create) {
          await statsClient.create({
            data: {
              videoId: video.id,
              views,
              likes,
              fetchedAt: new Date(),
            },
          });
          snapshots++;
        }
      } catch {
        // モデルが無い/フィールドが違う等は握りつぶし
      }
    }

    return NextResponse.json({ ok: true, scanned, upserts, snapshots });
  } catch (e: any) {
    console.error("ingest error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
