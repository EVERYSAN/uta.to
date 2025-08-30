// src/app/api/maintenance/backfill-yt-stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const API_KEY = process.env.YOUTUBE_API_KEY!;
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function iso(iso?: string | null): number | null {
  if (!iso) return null;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mm * 60 + s;
}

export async function POST(_req: NextRequest) {
  if (!API_KEY) return NextResponse.json({ error: "missing API key" }, { status: 500 });

  let updated = 0;
  const rows = await prisma.video.findMany({
    where: { platform: "YOUTUBE", OR: [{ views: 0 }, { views: null }] },
    select: { id: true, platformVideoId: true },
    take: 1000, // 必要に応じて増減
  });

  for (const ids of chunk(rows.map(r => r.platformVideoId), 50)) {
    const res = await fetch(`${VIDEOS_URL}?key=${API_KEY}&part=statistics,contentDetails&id=${ids.join(",")}`);
    const json: any = await res.json();
    for (const v of json.items ?? []) {
      const id = v.id as string;
      const stat = v.statistics ?? {};
      const dur = v.contentDetails?.duration;
      await prisma.video.updateMany({
        where: { platform: "YOUTUBE", platformVideoId: id },
        data: {
          views: parseInt(stat.viewCount ?? "0", 10) || 0,
          likes: parseInt(stat.likeCount ?? "0", 10) || 0,
          durationSec: iso(dur),
        },
      });
      updated++;
    }
  }

  return NextResponse.json({ target: rows.length, updated });
}

