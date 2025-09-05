// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { videoId } = await req.json();

    if (!videoId || typeof videoId !== "string") {
      return NextResponse.json(
        { ok: false, error: "INVALID_VIDEO_ID" },
        { status: 400 }
      );
    }

    // 1クリック = 1イベント追加 → 総件数を集計して返す
    const total = await prisma.$transaction(async (tx) => {
      await tx.supportEvent.create({ data: { videoId } });

      const agg = await tx.supportEvent.aggregate({
        where: { videoId },
        _count: { _all: true },
      });
      return agg._count._all ?? 0;
    });

    return NextResponse.json(
      { ok: true, videoId, total, at: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[support][POST] error", e);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
