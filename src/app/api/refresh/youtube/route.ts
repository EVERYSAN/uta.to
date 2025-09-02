// src/app/api/refresh/youtube/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { defined } from "@/lib/defined";
import { logError, logInfo } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") || "").trim();
  const hours = Number(url.searchParams.get("hours") ?? 24);
  const limit = Number(url.searchParams.get("limit") ?? 200);
  const q = url.searchParams.get("q") || "";

  if (!process.env.YT_API_KEY) {
    logError("YT_API_KEY missing");
    return NextResponse.json({ ok: false, error: "YT_API_KEY not set" }, { status: 500 });
  }

  try {
    // ここもあなたの実装に合わせて：ids か query で YouTube を叩いて配列を得る
    // 下はダミーの例（必要に応じて置き換え）
    const items: Array<{
      platformVideoId: string;
      url?: string | null;
      title?: string | null;
      thumbnailUrl?: string | null;
      durationSec?: number | null;
      publishedAt?: string | Date | null;
      channelTitle?: string | null;
      views?: number | null;
      likes?: number | null;
    }> = [];

    // DB upsert（null を渡さない）
    let upserts = 0;
    for (const v of items) {
      const publishedAt =
        v.publishedAt
          ? new Date(typeof v.publishedAt === "string" ? v.publishedAt : v.publishedAt)
          : undefined;

      const dataCommon = defined({
        title: v.title ?? undefined,
        url: v.url ?? undefined,
        thumbnailUrl: v.thumbnailUrl ?? undefined,
        durationSec: v.durationSec ?? undefined,
        channelTitle: v.channelTitle ?? undefined,
        views: v.views ?? undefined,
        likes: v.likes ?? undefined,
        ...(publishedAt ? { publishedAt } : {}),
      });

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform: "youtube", platformVideoId: v.platformVideoId } },
        create: defined({
          platform: "youtube",
          platformVideoId: v.platformVideoId,
          ...dataCommon,
        }),
        update: dataCommon,
      });

      upserts++;
    }

    logInfo("refresh/youtube ok", { ids: !!ids, q, hours, limit, upserts });
    return NextResponse.json({ ok: true, items, upserts });
  } catch (e: any) {
    logError("refresh/youtube failed", { msg: String(e?.message || e) });
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
