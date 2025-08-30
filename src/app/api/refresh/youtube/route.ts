import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const API = "https://www.googleapis.com/youtube/v3";

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseISODuration(iso?: string | null) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const sec = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + min * 60 + sec;
}

async function run(req: NextRequest) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "MISSING_API_KEY" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  // 既定は views/likes が 0 のものだけ更新
  const onlyMissing = (searchParams.get("onlyMissing") ?? "1") === "1";
  const take = Math.min(500, Math.max(1, parseInt(searchParams.get("take") ?? "500", 10)));

  // 👇 Prisma の型に合う where を明示的に作る（null 判定は使わない）
  const where: Prisma.VideoWhereInput = onlyMissing
    ? {
        platform: "youtube",
        OR: [
          { views: { equals: 0 } },
          { likes: { equals: 0 } },
        ],
      }
    : { platform: "youtube" };

  const rows = await prisma.video.findMany({
    where,
    select: { platformVideoId: true },
    orderBy: { publishedAt: "desc" },
    take,
  });

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, updated: 0 });
  }

  let updated = 0;
  const batches = chunk(rows.map((r) => r.platformVideoId), 50);

  for (const ids of batches) {
    const url = new URL(`${API}/videos`);
    url.search = new URLSearchParams({
      key,
      id: ids.join(","),
      part: "snippet,contentDetails,statistics",
    }).toString();

    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();

    for (const v of json.items ?? []) {
      const id = v.id as string;
      const sn = v.snippet ?? {};
      const det = v.contentDetails ?? {};
      const st = v.statistics ?? {};

      const durationSec = parseISODuration(det.duration);
      const channelTitle: string | undefined = sn.channelTitle ?? undefined;
      const views = st.viewCount !== undefined ? parseInt(st.viewCount, 10) : undefined;
      const likes = st.likeCount !== undefined ? parseInt(st.likeCount, 10) : undefined;

      await prisma.video.update({
        where: { platform_platformVideoId: { platform: "youtube", platformVideoId: id } },
        data: {
          ...(channelTitle !== undefined ? { channelTitle } : {}),
          ...(durationSec !== null ? { durationSec } : {}),
          ...(views !== undefined ? { views } : {}),
          ...(likes !== undefined ? { likes } : {}),
        },
      });

      updated++;
    }
  }

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    batches: batches.length,
    updated,
  });
}

export async function GET(req: NextRequest)  { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
