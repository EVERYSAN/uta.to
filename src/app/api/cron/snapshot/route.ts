// src/app/api/cron/snapshot/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

export const runtime = "nodejs"; // Prisma を使うので Node 実行

// ---- utils --------------------------------------------------------
type RefreshItem = {
  platform?: string | null;           // default "youtube"
  platformVideoId: string;            // 必須
  url?: string | null;
  title?: string | null;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  publishedAt?: string | Date | null;
  channelTitle?: string | null;
  views?: number | null;
  likes?: number | null;
};

const prisma = new PrismaClient();

function toDate(input: string | Date | null | undefined): Date | undefined {
  if (!input) return undefined;
  const d = typeof input === "string" ? new Date(input) : input;
  return isNaN(d.getTime()) ? undefined : d;
}
const logI = (m: string, meta?: any) => console.log(`[INFO] ${new Date().toISOString()} ${m}`, meta ?? "");
const logE = (m: string, meta?: any) => console.error(`[ERROR] ${new Date().toISOString()} ${m}`, meta ?? "");

// ---- route --------------------------------------------------------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? 24);
  const limit = Number(url.searchParams.get("limit") ?? 300);
  const query = url.searchParams.get("query") ?? "";

  // refresh 側で YouTube API を使うのでキー存在チェック
  if (!process.env.YT_API_KEY) {
    logE("YT_API_KEY not set");
    return NextResponse.json(
      { ok: false, route: "cron/snapshot", error: "YT_API_KEY not set" },
      { status: 500 }
    );
  }

  // 実行ベースURL解決
  const origin =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  if (!origin) {
    logE("Base URL unresolved (set NEXT_PUBLIC_BASE_URL or VERCEL_URL)");
    return NextResponse.json(
      { ok: false, route: "cron/snapshot", error: "Base URL not resolved" },
      { status: 500 }
    );
  }

  try {
    // 自サイトの refresh/youtube を叩いて取り込み対象を取得
    const refreshUrl = new URL("/api/refresh/youtube", origin);
    refreshUrl.searchParams.set("hours", String(hours));
    refreshUrl.searchParams.set("limit", String(limit));
    if (query) refreshUrl.searchParams.set("q", query);

    const r = await fetch(refreshUrl.toString(), { cache: "no-store" });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`refresh/youtube ${r.status} ${body}`);
    }
    const json = await r.json();
    const items: RefreshItem[] = Array.isArray(json?.items) ? json.items : [];

    let upserts = 0;
    let skippedNoId = 0;

    for (const it of items) {
      const platform = (it.platform ?? "youtube").toLowerCase();
      const platformVideoId = it.platformVideoId?.trim();

      if (!platformVideoId) {
        skippedNoId++;
        continue;
      }

      const pub = toDate(it.publishedAt);

      // update 用（Prisma.VideoUpdateInput）: null/undefined はそもそも入れない
      const updateData: Prisma.VideoUpdateInput = {
        ...(it.title ? { title: it.title } : {}),
        ...(it.url ? { url: it.url } : {}),
        ...(it.thumbnailUrl ? { thumbnailUrl: it.thumbnailUrl } : {}),
        ...(typeof it.durationSec === "number" ? { durationSec: it.durationSec } : {}),
        ...(it.channelTitle ? { channelTitle: it.channelTitle } : {}),
        ...(typeof it.views === "number" ? { views: it.views } : {}),
        ...(typeof it.likes === "number" ? { likes: it.likes } : {}),
        ...(pub ? { publishedAt: pub } : {}),
      };

      // create 用（Prisma.VideoCreateInput）: 必須2項目を確定 + 任意項目はプリミティブだけを個別に条件付与
      const createData: Prisma.VideoCreateInput = {
        platform,
        platformVideoId,
        ...(it.title ? { title: it.title } : {}),
        ...(it.url ? { url: it.url } : {}),
        ...(it.thumbnailUrl ? { thumbnailUrl: it.thumbnailUrl } : {}),
        ...(typeof it.durationSec === "number" ? { durationSec: it.durationSec } : {}),
        ...(it.channelTitle ? { channelTitle: it.channelTitle } : {}),
        ...(typeof it.views === "number" ? { views: it.views } : {}),
        ...(typeof it.likes === "number" ? { likes: it.likes } : {}),
        ...(pub ? { publishedAt: pub } : {}),
      };

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        create: createData,
        update: updateData,
      });

      upserts++;
    }

    logI("snapshot done", { hours, limit, query, fetched: items.length, upserts, skippedNoId });

    return NextResponse.json({
      ok: true,
      route: "cron/snapshot",
      params: { hours, limit, query },
      fetched: items.length,
      upserts,
      skippedNoId,
    });
  } catch (e: any) {
    logE("snapshot failed", { message: String(e?.message || e) });
    return NextResponse.json(
      { ok: false, route: "cron/snapshot", error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
