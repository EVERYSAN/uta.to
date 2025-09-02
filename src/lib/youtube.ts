// src/lib/youtube.ts
const YT_API_KEY = process.env.YT_API_KEY!;
const YT_BASE = "https://www.googleapis.com/youtube/v3";

export type RawVideo = {
  id: string;
  title: string;
  channelTitle?: string | null;
  url: string;
  thumbnailUrl?: string | null;
  publishedAt: string;    // ISO
  durationSec?: number | null;
  views?: number | null;
  likes?: number | null;
};

function parseISODurationToSec(iso?: string | null): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(iso);
  if (!m) return null;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + min * 60 + s;
}

/**
 * (A) 直近公開動画を search→videos で解決して返す
 */
export async function fetchRecentYouTube(params: {
  publishedAfterISO: string;
  maxPages?: number;
  maxItems?: number;
  regionCode?: string;
  query?: string;
}) {
  if (!YT_API_KEY) throw new Error("YT_API_KEY is not set");
  const {
    publishedAfterISO,
    maxPages = 10,
    maxItems = 100,
    regionCode = "JP",
    query,
  } = params;

  let pageToken: string | undefined;
  const out: RawVideo[] = [];
  let page = 0;

  while (page < maxPages && out.length < maxItems) {
    page += 1;
    const searchURL = new URL(`${YT_BASE}/search`);
    searchURL.searchParams.set("key", YT_API_KEY);
    searchURL.searchParams.set("part", "snippet");
    searchURL.searchParams.set("type", "video");
    searchURL.searchParams.set("order", "date"); // 新着順
    searchURL.searchParams.set("publishedAfter", publishedAfterISO);
    searchURL.searchParams.set("maxResults", "50");
    searchURL.searchParams.set("regionCode", regionCode);
    if (query) searchURL.searchParams.set("q", query);
    if (pageToken) searchURL.searchParams.set("pageToken", pageToken);

    const sres = await fetch(searchURL.toString());
    if (!sres.ok) throw new Error(`YouTube search failed: ${sres.status}`);
    const sjson = await sres.json();

    const ids: string[] = (sjson.items || [])
      .map((it: any) => it?.id?.videoId)
      .filter(Boolean);

    if (ids.length === 0) {
      pageToken = sjson.nextPageToken;
      if (!pageToken) break;
      continue;
    }

    const details = await fetchDetails(ids);
    out.push(...details);

    pageToken = sjson.nextPageToken;
    if (!pageToken) break;
  }

  return { items: out.slice(0, maxItems) };
}

/**
 * (B) “動画IDの配列”から詳細情報を取得（/videos）
 *    他のAPIから呼ばれている想定の fetchDetails を提供
 */
export async function fetchDetails(videoIds: string[]): Promise<RawVideo[]> {
  if (!YT_API_KEY) throw new Error("YT_API_KEY is not set");
  const out: RawVideo[] = [];
  // /videos は一度に最大50件
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const vidsURL = new URL(`${YT_BASE}/videos`);
    vidsURL.searchParams.set("key", YT_API_KEY);
    vidsURL.searchParams.set("part", "snippet,contentDetails,statistics");
    vidsURL.searchParams.set("id", chunk.join(","));

    const vres = await fetch(vidsURL.toString());
    if (!vres.ok) throw new Error(`YouTube videos failed: ${vres.status}`);
    const vjson = await vres.json();

    for (const v of vjson.items || []) {
      const id = v.id;
      const sn = v.snippet || {};
      const st = v.statistics || {};
      const cd = v.contentDetails || {};
      out.push({
        id,
        title: sn.title,
        channelTitle: sn.channelTitle ?? null,
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl:
          sn.thumbnails?.medium?.url ||
          sn.thumbnails?.default?.url ||
          null,
        publishedAt: sn.publishedAt,
        durationSec: parseISODurationToSec(cd.duration),
        views: st.viewCount != null ? Number(st.viewCount) : null,
        likes: st.likeCount != null ? Number(st.likeCount) : null,
      });
    }
  }
  return out;
}

/** 直近N時間ぶんをまとめて取るヘルパ */
export async function fetchRecentYouTubeSinceHours(
  hours = 24,
  opts?: { query?: string; regionCode?: string; limit?: number }
) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  return fetchRecentYouTube({
    publishedAfterISO: since,
    maxPages: 10,
    maxItems: opts?.limit ?? 200,
    regionCode: opts?.regionCode ?? "JP",
    query: opts?.query,
  });
}
