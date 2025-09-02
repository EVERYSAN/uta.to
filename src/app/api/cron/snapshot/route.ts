import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

export const runtime = "nodejs";

type RefreshItem = {
  platform?: string | null;
  platformVideoId: string;
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

function toDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  const d = typeof input === "string" ? new Date(input) : input;
  return isNaN(d.getTime()) ? null : d;
}

const info = (m: string, meta?: any) =>
  console.log(`[INFO] ${new Date().toISOString()} ${m}`, meta ?? "");
const error = (m: string, meta?: any) =>
  console.error(`[ERROR] ${new Date().toISOString()} ${m}`, meta ?? "");

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? 24);
  const limit = Number(url.searchParams.get("limit") ?? 300);
  const q = url.searchParams.get("query") ?? "";

  if (!process.env.YT_API_KEY) {
    error("YT_API_KEY not set");
    return NextResponse.json(
      { ok: false, route: "cron/snapshot", error: "YT_API_KEY not set" },
      { status: 500 }
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!origin) {
    error("Base URL unresolved");
    return NextResponse.json(
      { ok: false, route: "cron/snapshot", error: "Base URL not resolved" },
      { status: 500 }
    );
  }

  try {
    const refreshUrl = new URL("/api/refresh/youtube", origin);
    refreshUrl.searchParams.set("hours", String(hours));
    refreshUrl.searchParams.set("limit", String(limit));
    if (q) refreshUrl.searchParams.set("q", q);

    const r = await fetch(refreshUrl.toString(), { cache: "no-store" });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`refresh/youtube ${r.status} ${body}`);
    }

    const json = await r.json();
    const items: RefreshItem[] = Array.isArray(json?.items) ? json.items : [];

    let fetched = items.length;
    let upserts = 0;
    let skippedNoId = 0;

    for (const it of items) {
      const platform = (it.platform ?? "youtube").toLowerCase();
      const platformVideoId = (it.platformVideoId ?? "").trim();
      if (!platformVideoId) {
        skippedNoId++;
        continue;
      }

      // ---- フォールバックを確定（必須フィールドは常に非 undefined）----
      const safeTitle = (it.title ?? "").trim() || `video ${platformVideoId}`;
      const safeUrl =
        (it.url ?? "").trim() ||
        `https://www.youtube.com/watch?v=${platformVideoId}`;
      const safeThumb =
        (it.thumbnailUrl ?? "").trim() ||
        `https://i.ytimg.com/vi/${platformVideoId}/hqdefault.jpg`;
      // ここが重要：必須扱いの publishedAt は常に Date を入れる
      const safePublishedAt: Date = toDate(it.publishedAt) ?? new Date();

      // ---- update 用：値がある時だけ更新（既存を壊さない）----
      const updateData: Prisma.VideoUpdateInput = {};
      if (it.title) updateData.title = it.title;
      if (it.url) updateData.url = it.url;
      if (it.thumbnailUrl) updateData.thumbnailUrl = it.thumbnailUrl;
      if (typeof it.durationSec === "number")
        updateData.durationSec = it.durationSec;
      if (it.channelTitle) updateData.channelTitle = it.channelTitle;
      if (typeof it.views === "number") updateData.views = it.views;
      if (typeof it.likes === "number") updateData.likes = it.likes;
      // publishedAt は update 時も値がある時だけ
      if (toDate(it.publishedAt)) updateData.publishedAt = safePublishedAt;

      // ---- create 用：必須を先に確定してから任意項目を段階的に付与 ----
      const createData: Prisma.VideoCreateInput = {
        platform,
        platformVideoId,
        title: safeTitle,
        url: safeUrl,
        thumbnailUrl: safeThumb,
        publishedAt: safePublishedAt,
      };
      if (typeof it.durationSec === "number")
        (createData as any).durationSec = it.durationSec;
      if (it.channelTitle) (createData as any).channelTitle = it.channelTitle;
      if (typeof it.views === "number") (createData as any).views = it.views;
      if (typeof it.likes === "number") (createData as any).likes = it.likes;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        create: createData,
        update: updateData,
      });

      upserts++;
    }

    info("snapshot done", {
      hours,
      limit,
      query: q,
      fetched,
      upserts,
      skippedNoId,
    });

    return NextResponse.json({
      ok: true,
      route: "cron/snapshot",
      params: { hours, limit, query: q },
      fetched,
      upserts,
      skippedNoId,
    });
  } catch (e: any) {
    error("snapshot failed", { message: String(e?.message || e) });
    return NextResponse.json(
      { ok: false, route: "cron/snapshot", error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
