// src/app/api/support/route.ts
import prisma from "@/lib/prisma";
import { getRequestFingerprint, startOfTodayJSTUtc } from "@/lib/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 応援ポイント加算API
 * - 同一IP(ハッシュ)はJST日付で1日1回まで（動画ごと）
 * - amountは1〜10に丸めて許可
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoId = String(body.videoId || "");
    let amount = Number.isFinite(body.amount) ? Math.floor(body.amount) : 1;
    amount = Math.min(10, Math.max(1, amount));

    if (!videoId) {
      return Response.json({ ok: false, error: "videoId required" }, { status: 400 });
    }

    // 指紋 & JSTの本日0時（UTC換算）
    const { hash: ipHash, ua } = getRequestFingerprint(req);
    const since = startOfTodayJSTUtc();

    // 既に本日押していれば何もしない
    const dup = await prisma.supportEvent.findFirst({
      where: { videoId, ipHash, createdAt: { gte: since } },
      select: { id: true },
    });
    if (dup) {
      const v = await prisma.video.findUnique({
        where: { id: videoId },
        select: { supportPoints: true },
      });
      return Response.json({ ok: true, already: true, points: v?.supportPoints ?? 0 });
    }

    // 記録 & 集計をトランザクションで
    await prisma.$transaction([
      prisma.supportEvent.create({ data: { videoId, amount, ipHash, userAgent: ua } }),
      prisma.video.update({ where: { id: videoId }, data: { supportPoints: { increment: amount } } }),
    ]);

    const v2 = await prisma.video.findUnique({
      where: { id: videoId },
      select: { supportPoints: true },
    });

    return Response.json({ ok: true, points: v2?.supportPoints ?? amount });
  } catch (err) {
    console.error("[support] POST error", err);
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
