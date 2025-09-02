// src/app/api/refresh/youtube/route.ts
import { NextResponse } from "next/server";
import { Prisma, type Video } from "@prisma/client";
import { prisma } from "@/lib/prisma"; // ← ルート内で new せず、lib から import
import { fetchDetails } from "@/lib/youtube";

// これらの export は Next.js で許可されている
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "sin1";

function parseIdsFromURL(url: string): string[] {
  const sp = new URL(url).searchParams;
  const idsRaw = sp.get("ids");
  if (!idsRaw) return [];
  return idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50); // 念のため上限
}

function safeThumb(v: any): string | undefined {
  const sn = v?.snippet;
  const t = sn?.thumbnails;
  return (
    v?.thumbnailUrl ||
    t?.maxres?.url ||
    t?.standard?.url ||
    t?.high?.url ||
    t?.medium?.url ||
    t?.default?.url ||
    undefined
  );
}

export async function GET(req: Request) {
  try {
    const ids = parseIdsFromURL(req.url);
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "required: ids" }, { status: 400 });
    }

    // YouTube 詳細を取得
    const items = await fetchDetails(ids);

    let upserts = 0;
    const results: Pick<Video, "id" | "platform" | "platformVideoId">[] = [];

    for (const it of items) {
      const platform = "youtube";
      const platformVideoId =
        it.platformVideoId ?? it.id ?? it.contentDetails?.videoId ?? "";

      if (!platformVideoId) continue;

      const title = (it.title ?? it.snippet?.title ?? "").trim();
      const safeTitle = title || `video ${platformVideoId}`;

      const url = it.url ?? `https://www.youtube.com/watch?v=${platformVideoId}`;
      const thumbnailUrl = safeThumb(it);
      const channelTitle = it.channelTitle ?? it.snippet?.channelTitle ?? "";

      // publishedAt は必須。なければ now を入れて型を満たす
      const pubInput = it.publishedAt ?? it.snippet?.publishedAt ?? null;
      const publishedAt: Date = pubInput ? new Date(pubInput) : new Date();

      // 任意（schema では optional）
      const durationSec =
        typeof it.durationSec === "number" ? it.durationSec : undefined;
      const views =
        typeof it.views === "number" ? it.views : undefined;
      const likes =
        typeof it.likes === "number" ? it.likes : undefined;

      // ★ create は Prisma.VideoCreateInput を“必須フィールドを確実に”満たす形で明示的に構築
      const createData: Prisma.VideoCreateInput = {
        platform,
        platformVideoId,
        title: safeTitle,         // required
        url,                      // required
        publishedAt,              // required
        // optional
        thumbnailUrl,
        durationSec,
        channelTitle,             // schemaで@default("")なので未指定でも良いが、入れておく
        views,
        likes,
        rawJson: it as any,
      };

      // ★ update は Prisma.VideoUpdateInput で OK（全て optional 扱い）
      const updateData: Prisma.VideoUpdateInput = {
        title: safeTitle,
        url,
        publishedAt, // まれに変わる可能性があるため上書き許容
        thumbnailUrl,
        durationSec,
        channelTitle,
        views,
        likes,
        rawJson: it as any,
      };

      const row = await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        create: createData,
        update: updateData,
        select: { id: true, platform: true, platformVideoId: true },
      });

      results.push(row);
      upserts++;
    }

    return NextResponse.json({ ok: true, requested: ids.length, fetched: items.length, upserts, results });
  } catch (err: any) {
    // 型安全に NextResponse を返す
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
