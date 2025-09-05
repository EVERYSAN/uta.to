// src/app/api/support/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

/** ユーザーのグローバル IP をできる限り取得（Vercel/Proxy 対応） */
function getClientIp(req: Request): string {
  const h = req.headers;
  const cand =
    h.get("x-forwarded-for") ||
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    h.get("x-vercel-forwarded-for");
  if (!cand) return "0.0.0.0";
  // x-forwarded-for は "client, proxy1, proxy2" 形式なので先頭を採用
  return cand.split(",")[0].trim();
}

/** その日のバケットキー（1日1回の応援制限などに使う） */
function dayKey(d = new Date()): string {
  // JSTで固定したい場合はここで補正してから toISOString してもOK
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/** 文字列を SHA-256(hex) に */
function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function POST(req: Request) {
  try {
    const { videoId } = await req.json();

    if (!videoId || typeof videoId !== "string") {
      return NextResponse.json(
        { ok: false, error: "missing_videoId" },
        { status: 400 }
      );
    }

    // 1) IP と日付から匿名ハッシュを作る（同一IPの同一日で同一 videoId を一意に）
    const ip = getClientIp(req) || "0.0.0.0";
    const today = dayKey();
    const ipHash = sha256Hex(`${ip}|${today}`);

    // 2) SupportEvent を作成（ユニーク制約がある場合はここで P2002 が出る）
    let duplicated = false;
    try {
      // ※ スキーマが supportEvent に dayKey（などの列名）を必須にしているなら一緒に渡してください:
      // data: { videoId, ipHash, dayKey: today }
      await prisma.supportEvent.create({
        data: { videoId, ipHash },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        // 既に今日そのIPから同じ動画が応援済み
        duplicated = true;
      } else {
        throw e; // 想定外は500へ
      }
    }

    // 3) 動画の累計カウンタを更新（重複時は増やさず現状値を返す）
    let points: number;
    if (!duplicated) {
      const upd = await prisma.video.update({
        where: { id: videoId },
        // Video.supportPoints(Int) 前提。列名が違うなら合わせて変更してください。
        data: { supportPoints: { increment: 1 } },
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
    // ここに来るのは想定外の DB/実行時エラーのみ
    return NextResponse.json(
      { ok: false, error: err?.message || "internal_error" },
      { status: 500 }
    );
  }
}
