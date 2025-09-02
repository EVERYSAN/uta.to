// src/app/api/cron/snapshot/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

export const runtime = "nodejs"; // Prisma 使うので Node 実行

// --- minimal utils -------------------------------------------------
function omitNullish<T extends Record<string, any>>(obj: T) {
  const out: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out as T;
}
const prisma = new PrismaClient();
const info = (msg: string, meta?: any) =>
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`, meta ?? "");
const error = (msg: string, meta?: any) =>
  console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, meta ?? "");

// --- 入力アイテム型（refresh/youtube の返却想定） -------------------
type RefreshItem = {
  platform?: string | null; // 既定: "youtube"
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

// --- ルート --------------------------------------------------------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? 24);
  const limit = Number(url.searchParams.get("limit") ?? 300);
  const query = url.searchParams.get("query") ?? "";

  // ※ YouTube APIキーの存在チェック（refresh 側で必要になる）
  if (!process.env.YT_API_KEY) {
    error("YT_API_KEY not set");
    return NextResponse.json(
      { ok: false, route: "cron/snapshot", error: "YT_API_KEY not set" },
      { status: 500 }
    );
  }

  // 自サイトの refresh エンドポイントを叩いて一覧を得る
  const origin =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  if (!origin) {
    error("Base URL unresolved (NEXT_PUBLIC_BASE_URL or VERCEL_URL)");
    return NextResponse.json(
      { ok: false, route: "cron/snapshot", error: "Base URL not resolved" },
      { status: 500 }
    );
  }

  try {
    const refreshUrl = new URL("/api/refresh/youtube", origin);
    refreshUrl.searchParams.set("hours", String(hours));
    refreshUrl.searchParams.set("limit", String(limit));
    if (query) refreshUrl.searchParams.set("q", query);

    const res = await fetch(refreshUrl.toString(), { cache: "no-store" });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`refresh/youtube ${res.status} ${txt}`);
    }
    const json = await res.json();
    const items: RefreshItem[] = Array.isArray(json?.items) ? json.items : [];

    let upserts = 0;
    let skippedNoId = 0;

    for (const r of items) {
      const platform = (r.platform ?? "youtube").toLowerCase();
      const platformVideoId = r.platformVideoId?.trim();

      if (!platformVideoId) {
        skippedNoId++;
        continue;
      }

      // publishedAt は Date に正規化（不正なら入れない）
      const publishedAt =
        r.publishedAt
          ? new Date(typeof r.publishedAt === "string" ? r.publishedAt : r.publishedAt)
          : undefined;
      const pubOk = publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined;

      // update 用（null/undefined を削除した上で、Prisma の UpdateInput に寄せる）
      const updateData: Prisma.VideoUpdateInput = omitNullish({
        title: r.title ?? undefined,
        url: r.url ?? undefined,
        thumbnailUrl: r.thumbnailUrl ?? undefined,
        durationSec: r.durationSec ?? undefined,
        channelTitle: r.channelTitle ?? undefined,
        views: r.views ?? undefined,
        likes: r.likes ?? undefined,
        ...(pubOk ? { publishedAt: pubOk } : {}),
      });

      // create 用：必須キーは確定的に入れる（ここが前回の型エラー原因）
      const createData: Prisma.VideoCreateInput = {
        platform,
        platformVideoId,
        ...(updateData as Omit<Prisma.VideoUpdateInput, "publishedAt">),
        ...(pubOk ? { publishedAt: pubOk } : {}),
      };

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        create: createData,
        update: updateData,
      });

      upserts++;
    }

    info("snapshot done", { hours, limit, query, fetched: items.length, upserts, skippedNoId });

    return NextResponse.json({
      ok: true,
      route: "cron/snapshot",
      params: { hours, limit, query },
      fetched: items.length,
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
