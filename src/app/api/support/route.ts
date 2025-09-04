// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";      // Prisma は edge で動かさない
export const dynamic = "force-dynamic"; // キャッシュ無効
export const revalidate = 0;

function json(data: any, init: number = 200) {
  return NextResponse.json(data, {
    status: init,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId") ?? url.searchParams.get("id");
  if (!videoId) return json({ ok: false, error: "missing_videoId" }, 400);

  try {
    const v = await prisma.video.findFirst({
      where: { OR: [{ id: videoId }, { platformVideoId: videoId }] },
      select: { supportPoints: true },
    });
    if (!v) return json({ ok: false, error: "not_found" }, 404);
    return json({ ok: true, points: v.supportPoints ?? 0 });
  } catch (e: any) {
    return json({ ok: false, error: "internal_error", detail: e?.message }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const videoId = body?.videoId ?? body?.id;
    if (!videoId) return json({ ok: false, error: "missing_videoId" }, 400);

    // id / platformVideoId どちらでもヒットするように
    const target = await prisma.video.findFirst({
      where: { OR: [{ id: videoId }, { platformVideoId: videoId }] },
      select: { id: true },
    });
    if (!target) return json({ ok: false, error: "not_found" }, 404);

    // 応援ポイントを +1
    const updated = await prisma.video.update({
      where: { id: target.id },
      data: { supportPoints: { increment: 1 } },
      select: { supportPoints: true },
    });

    // もしログ用テーブルが存在しない構成でも落ちないように完全に無視
    // try { await prisma.supportLog.create({ data: { videoId: target.id } }); } catch {}

    return json({ ok: true, points: updated.supportPoints ?? 0 });
  } catch (e: any) {
    return json({ ok: false, error: "internal_error", detail: e?.message }, 500);
  }
}
