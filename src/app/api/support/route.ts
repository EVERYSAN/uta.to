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

    // 1トランザクション: SupportEvent 追加 + 累計 supportTotal を +1
    const total = await prisma.$transaction(async (tx) => {
      await tx.supportEvent.create({
        data: { videoId }, // ← points は存在しないので渡さない
      });

      const upd = await tx.video.update({
        where: { id: videoId },
        data: { supportTotal: { increment: 1 } },
        select: { supportTotal: true },
      });

      return upd.supportTotal;
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
