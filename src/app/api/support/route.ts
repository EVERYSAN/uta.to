// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { videoId, points = 1 } = await req.json();

    if (!videoId || typeof videoId !== "string") {
      return NextResponse.json({ ok: false, error: "INVALID_VIDEO_ID" }, { status: 400 });
    }
    const inc = Number(points) || 1;

    // 1トランザクションで SupportEvent 作成 + 累計を加算
    const total = await prisma.$transaction(async (tx) => {
      await tx.supportEvent.create({
        data: { videoId, points: inc }, // points列がない場合は 1 固定でもOK
      });
      const upd = await tx.video.update({
        where: { id: videoId },
        data: { supportTotal: { increment: inc } }, // schemaで Int default 0 を想定
        select: { supportTotal: true },
      });
      return upd.supportTotal;
    });

    // 即時リフレッシュ用のヒントヘッダ（クライアントで使うなら）
    const headers = new Headers({
      "Cache-Control": "no-store",
      "x-support-updated": "1",
    });

    return NextResponse.json(
      { ok: true, videoId, total, at: new Date().toISOString() },
      { headers }
    );
  } catch (e: any) {
    console.error("[support][POST] error", e);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
