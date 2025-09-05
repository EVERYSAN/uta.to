// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { videoId } = await req.json();

    if (!videoId || typeof videoId !== "string") {
      return NextResponse.json(
        { ok: false, error: "missing_videoId" },
        { status: 400 }
      );
    }

    let duplicated = false;

    // まず SupportEvent を作成してみる（ユニーク制約があればここで重複検知）
    try {
      await prisma.supportEvent.create({
        data: { videoId }, // points列が無い想定。あるなら { videoId, points: 1 }
      });
    } catch (e: any) {
      // Prisma Unique constraint violation
      if (e?.code === "P2002") {
        duplicated = true;
      } else {
        // それ以外は上に投げる（未知のDBエラー）
        throw e;
      }
    }

    // 重複でなければカウンタを+1、重複なら現状値を読むだけ
    let points: number;
    if (!duplicated) {
      const upd = await prisma.video.update({
        where: { id: videoId },
        data: { supportPoints: { increment: 1 } }, // ← スキーマは Video.supportPoints:Int を前提
        select: { supportPoints: true },
      });
      points = upd.supportPoints ?? 0;
    } else {
      const v = await prisma.video.findUnique({
        where: { id: videoId },
        select: { supportPoints: true },
      });
      points = v?.supportPoints ?? 0;
    }

    return NextResponse.json(
      { ok: true, points, duplicated },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "internal_error" },
      { status: 500 }
    );
  }
}
