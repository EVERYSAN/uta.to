// src/app/api/refresh/youtube/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { fetchDetails } from "@/lib/youtube";

const prisma = new PrismaClient();

/**
 * /api/refresh/youtube?ids=AaBb,BbCc
 * or POST { "ids": ["AaBb", "BbCc"] }
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const idsParam = url.searchParams.get("ids") || "";
    const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "required: ids" }, { status: 400 });
    }
    return NextResponse.json(await refreshByIds(ids), { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "required: JSON body { ids: string[] }" }, { status: 400 });
    }
    return NextResponse.json(await refreshByIds(ids), { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

async function refreshByIds(ids: string[]) {
  const t0 = Date.now();
  const details = await fetchDetails(ids);
  const platform = "youtube";

  let upserts = 0;
  let skippedNoPublishedAt = 0;
  const errors: string[] = [];

  for (const v of details) {
    try {
      const platformVideoId = v.id;

      // publishedAt は必須想定：無ければスキップ
      if (!v.publishedAt) {
        skippedNoPublishedAt++;
        continue;
      }
      const publishedAt = new Date(v.publishedAt);

      // null/undefined を update に渡さない（条件付きスプレッドで省略）
      const title: string | undefined = v.title ?? undefined;
      const urlStr: string = `https://www.youtube.com/watch?v=${platformVideoId}`;
      const thumbnailUrl: string | undefined = v.thumbnailUrl ?? undefined;
      const channelTitle: string | undefined = v.channelTitle ?? undefined;
      const durationSec: number | undefined = v.durationSec ?? undefined;
      const views: number | undefined = v.views ?? undefined;
      const likes: number | undefined = v.likes ?? undefined;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        update: {
          ...(title !== undefined ? { title } : {}),
          url: urlStr,
          ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
          ...(channelTitle !== undefined ? { channelTitle } : {}),
          ...(durationSec !== undefined ? { durationSec } : {}),
          publishedAt,
          ...(views !== undefined ? { views } : {}),
          ...(likes !== undefined ? { likes } : {}),
        },
        create: {
          platform,
          platformVideoId,
          title: title ?? "(untitled)",
          url: urlStr,
          thumbnailUrl: thumbnailUrl ?? "",
          channelTitle: channelTitle ?? "",
          durationSec,
          publishedAt,
          views,
          likes,
        },
        select: { id: true },
      });

      upserts++;
    } catch (e: any) {
      errors.push(String(e?.message || e));
    }
  }

  const latest = await prisma.video.findFirst({
    orderBy: [{ publishedAt: "desc" }],
    select: { platform: true, publishedAt: true, createdAt: true },
  });

  return {
    ok: true,
    requested: ids.length,
    fetched: details.length,
    upserts,
    skippedNoPublishedAt,
    latest,
    tookMs: Date.now() - t0,
    errors: errors.length ? errors.slice(0, 5) : undefined,
  };
}
