// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidateTag, revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function checkCronAuth(req: Request) { /* ←上の関数そのまま */ }
async function withAdvisoryLock<T>(fn: () => Promise<T>) { /* ←上の関数そのまま */ }
function toIntOrUndef(s?: string) { /* ←上の関数そのまま */ }
function parseISODurationToSeconds(d?: string) { /* 既存のもの */ }

export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return NextResponse.json({ ok:false, error:"unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const dryRun = url.searchParams.get("dry") === "1";

  return withAdvisoryLock(async () => {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 72); // 72h 既定
    const keys = (process.env.YOUTUBE_API_KEYS ?? process.env.YOUTUBE_API_KEY ?? "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (keys.length === 0) {
      return NextResponse.json({ ok:false, error:"NO_YOUTUBE_KEY" }, { status: 500 });
    }

    // 1) 収集
    const items = await collectYoutube(keys, "歌ってみた", since); // ←既存の収集関数に合わせて

    // 2) 追加で動画詳細を取得（duration, stats）
    const detMap = await getVideoDetails(keys[0], items.map(i => i.id?.videoId).filter(Boolean));

    // 3) rows へマップ（null 排除, undefined 許容）
    const rows: Prisma.VideoCreateManyInput[] = items
      .map(i => {
        const vid = i.id?.videoId;
        if (!vid) return null;
        const det = detMap.get(vid);
        return {
          platform: "youtube",
          platformVideoId: vid,
          title: i.snippet?.title ?? "",
          channelTitle: i.snippet?.channelTitle ?? "",
          url: `https://www.youtube.com/watch?v=${vid}`,
          thumbnailUrl: i.snippet?.thumbnails?.high?.url ?? i.snippet?.thumbnails?.medium?.url,
          durationSec: parseISODurationToSeconds(det?.contentDetails?.duration) ?? undefined,
          publishedAt: new Date(i.snippet?.publishedAt ?? Date.now()),
          views: toIntOrUndef(det?.statistics?.viewCount),
          likes: toIntOrUndef(det?.statistics?.likeCount),
        };
      })
      .filter((r): r is Prisma.VideoCreateManyInput => r !== null);

    // 4) 書き込み（idempotent）
    const result = dryRun
      ? { count: 0 }
      : await prisma.video.createMany({ data: rows, skipDuplicates: true });

    // 5) 再検証
    if (!dryRun && result.count > 0) {
      try {
        revalidateTag("videos-newest");
        revalidateTag("trending-1d");
        revalidateTag("trending-7d");
        revalidateTag("trending-30d");
      } catch {}
      // タグ未対応なら一旦:
      // revalidatePath("/");
    }

    const payload = {
      ok: true,
      meta: { now: new Date().toISOString(), since: since.toISOString(), dryRun },
      counts: { fetched: items.length, inserted: result.count },
      sample: rows.slice(0, 3),
    };
    return NextResponse.json(debug ? payload : { ok: true, counts: payload.counts });
  });
}
