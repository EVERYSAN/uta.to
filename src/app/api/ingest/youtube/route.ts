import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const API = "https://www.googleapis.com/youtube/v3";

// PT#H#M#S → 秒
function parseISODuration(iso?: string | null) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const sec = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + min * 60 + sec;
}

export async function GET(req: NextRequest) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "MISSING_API_KEY" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "歌ってみた";
  const maxResults = Math.min(50, Math.max(1, parseInt(searchParams.get("maxResults") ?? "50", 10)));
  const pages = Math.min(5, Math.max(1, parseInt(searchParams.get("pages") ?? "1", 10))); // nextPageToken を追う回数

  let pageToken: string | undefined = searchParams.get("pageToken") ?? undefined;
  let scanned = 0;
  let upserts = 0;

  for (let i = 0; i < pages; i++) {
    // 1) まず videoId を収集（軽量）
    const searchUrl = new URL(`${API}/search`);
    searchUrl.search = new URLSearchParams({
      key,
      q,
      part: "id",
      type: "video",
      order: "date",
      maxResults: String(maxResults),
      ...(pageToken ? { pageToken } : {}),
    }).toString();

    const sRes = await fetch(searchUrl, { cache: "no-store" });
    const sJson = await sRes.json();
    const ids: string[] = (sJson.items ?? []).map((it: any) => it?.id?.videoId).filter(Boolean);
    pageToken = sJson.nextPageToken ?? undefined;

    if (ids.length === 0) break;
    scanned += ids.length;

    // 2) 本体情報＋統計を取得
    const videosUrl = new URL(`${API}/videos`);
    videosUrl.search = new URLSearchParams({
      key,
      id: ids.join(","),
      part: "snippet,contentDetails,statistics",
    }).toString();

    const vRes = await fetch(videosUrl, { cache: "no-store" });
    const vJson = await vRes.json();

    for (const v of vJson.items ?? []) {
      const id = v.id as string;
      const sn = v.snippet ?? {};
      const det = v.contentDetails ?? {};
      const st = v.statistics ?? {};

      const title = sn.title ?? "";
      const description = sn.description ?? "";
      const publishedAt = sn.publishedAt ? new Date(sn.publishedAt) : new Date();
      const thumbnailUrl =
        sn.thumbnails?.maxres?.url ||
        sn.thumbnails?.standard?.url ||
        sn.thumbnails?.high?.url ||
        sn.thumbnails?.medium?.url ||
        sn.thumbnails?.default?.url ||
        null;

      const durationSec = parseISODuration(det.duration);
      const channelTitle = sn.channelTitle ?? "";
      const views = st.viewCount ? parseInt(st.viewCount, 10) : 0;
      const likes = st.likeCount ? parseInt(st.likeCount, 10) : 0;

      // 複合一意キー @@unique([platform, platformVideoId]) で upsert
      await prisma.video.upsert({
        where: {
          platform_platformVideoId: { platform: "youtube", platformVideoId: id },
        },
        update: {
          platform: "youtube",
          title,
          description,
          url: `https://www.youtube.com/watch?v=${id}`,
          thumbnailUrl,
          durationSec,
          publishedAt,
          channelTitle,
          views,
          likes,
        },
        create: {
          platform: "youtube",
          platformVideoId: id,
          title,
          description,
          url: `https://www.youtube.com/watch?v=${id}`,
          thumbnailUrl,
          durationSec,
          publishedAt,
          channelTitle,
          views,
          likes,
        },
      });

      upserts++;
    }

    if (!pageToken) break; // これ以上ページが無ければ終了
  }

  return NextResponse.json({ ok: true, scanned, upserts, nextPageToken: pageToken ?? null });
}
