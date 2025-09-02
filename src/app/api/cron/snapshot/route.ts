// src/app/api/refresh/youtube/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { fetchDetails } from "@/lib/youtube";

const prisma = new PrismaClient();

/**
 * /api/refresh/youtube?ids=AaBbCc,DdEeF
 * もしくは POST { "ids": ["AaBbCc", "DdEeF"] }
 * の形で呼び出し、指定IDの動画詳細をYouTubeから取り直してDB更新します。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const idsParam = url.searchParams.get("ids") || "";
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "required: ids (comma separated)" },
        { status: 400 }
      );
    }

    return NextResponse.json(await refreshByIds(ids), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];

    if (ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "required: JSON body { ids: string[] }" },
        { status: 400 }
      );
    }

    return NextResponse.json(await refreshByIds(ids), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

async function refreshByIds(ids: string[]) {
  const t0 = Date.now();
  const details = await fetchDetails(ids); // YouTube /videos から詳細取得
  const platform = "youtube";

  let upserts = 0;
  let skippedNoPublishedAt = 0;
  const errors: string[] = [];

  for (const v of details) {
    try {
      const platformVideoId = v.id;

      // publishedAt はスキーマ上 DateTime（必須想定）。無いものは更新しない。
      if (!v.publishedAt) {
        skippedNoPublishedAt++;
        continue;
      }
      const publishedAt = new Date(v.publishedAt);

      // 文字列フィールドは null を渡さず、undefined で「省略する」。
      const title: string | undefined = v.title ?? undefined;
      const urlStr: string = `https://www.youtube.com/watch?v=${platformVideoId}`;
      const thumbnailUrl: string | undefined = v.thumbnailUrl ?? undefined;
      const channelTitle: string | undefined = v.channelTitle ?? undefined;

      // 数値も null は渡さず undefined。
      const durationSec: number | undefined = v.durationSec ?? undefined;
      const views: number | undefined = v.views ?? undefined;
      const likes: number | undefined = v.likes ?? undefined;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        update: {
          ...(title !== undefined ? { title } : {}),
          url: urlStr, // 常にURLは補正
          ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
          ...(channelTitle !== undefined ? { channelTitle } : {}),
          ...(durationSec !== undefined ? { durationSec } : {}),
          publishedAt, // まれに変化する可能性があるので上書き
          ...(views !== undefined ? { views } : {}),
          ...(likes !== undefined ? { likes } : {}),
        },
        create: {
          platform,
          platformVideoId,
          title: title ?? "(untitled)", // create は空文字/デフォルトで埋める
          url: urlStr,
          thumbnailUrl: thumbnailUrl ?? "",
          channelTitle: channelTitle ?? "",
          durationSec,
          publishedAt,
          views,
          likes,
          // createdAt は schema の @default(now()) に任せる
        },
        select: { id: true },
      });

      upserts++;
    } catch (e: any) {
      errors.push(String(e?.message || e));
    }
  }

  // 直近の公開/入荷の確認
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
