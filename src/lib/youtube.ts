// src/lib/youtube.ts
const KEY = process.env.YOUTUBE_API_KEY ?? process.env.YT_API_KEY ?? "";

export type YtVideo = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  channelTitle: string;
  publishedAt: Date;
  durationSec: number | null;
  views: number;
  likes: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function iso8601ToSec(iso: string | undefined): number | null {
  if (!iso) return null;
  // PT#H#M#S → 秒
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const [, h, min, s] = m;
  return (parseInt(h || "0") * 3600) + (parseInt(min || "0") * 60) + (parseInt(s || "0"));
}

export async function searchPages(opts: {
  q: string;
  maxPages?: number;          // 既定 80 (= 最大4000件)
  publishedAfter?: string;    // ISO8601
  delayMs?: number;           // 既定 120ms
}) {
  if (!KEY) throw new Error("Missing YOUTUBE_API_KEY");
  const { q, maxPages = 80, publishedAfter, delayMs = 120 } = opts;

  const ids: string[] = [];
  let pageToken = "";
  for (let i = 0; i < maxPages; i++) {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("key", KEY);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("order", "date");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("q", q);
    if (publishedAfter) url.searchParams.set("publishedAfter", publishedAfter);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`YT search error ${r.status}`);
    const json = await r.json();
    for (const it of json.items ?? []) {
      const vid = it?.id?.videoId;
      if (vid) ids.push(vid);
    }
    pageToken = json.nextPageToken ?? "";
    if (!pageToken) break;
    await sleep(delayMs);
  }
  // 去重
  return Array.from(new Set(ids));
}

export async function fetchDetails(ids: string[], delayMs = 120): Promise<YtVideo[]> {
  if (!KEY) throw new Error("Missing YOUTUBE_API_KEY");
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("key", KEY);
    url.searchParams.set("part", "snippet,contentDetails,statistics");
    url.searchParams.set("id", chunk.join(","));

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`YT videos error ${r.status}`);
    const json = await r.json();
    for (const it of json.items ?? []) {
      const id = it.id as string;
      const sn = it.snippet ?? {};
      const st = it.statistics ?? {};
      const cd = it.contentDetails ?? {};
      const thumb =
        sn?.thumbnails?.maxres?.url ??
        sn?.thumbnails?.standard?.url ??
        sn?.thumbnails?.high?.url ??
        sn?.thumbnails?.medium?.url ??
        sn?.thumbnails?.default?.url ??
        null;

      out.push({
        id,
        title: sn.title ?? "",
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl: thumb,
        channelTitle: sn.channelTitle ?? "",
        publishedAt: sn.publishedAt ? new Date(sn.publishedAt) : new Date(),
        durationSec: iso8601ToSec(cd.duration),
        views: Number(st.viewCount ?? 0),
        likes: Number(st.likeCount ?? 0),
      });
    }
    await sleep(delayMs);
  }
  return out;
}
