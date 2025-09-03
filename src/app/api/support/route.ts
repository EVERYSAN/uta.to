import prisma from "@/lib/prisma";
import { getRequestFingerprint, startOfTodayJSTUtc } from "@/lib/support";

/**
 * 応援ボタン：1IP/日/動画に1回まで
 * body: { videoId: string, amount?: number(>=1) }
 * return: { ok: true, points: number, already?: true } or { ok:false, error:string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoId = String(body.videoId || "");
    let amount = Number(body.amount ?? 1);
    if (!videoId) return Response.json({ ok: false, error: "videoId is required" }, { status: 400 });
    if (!Number.isFinite(amount) || amount < 1) amount = 1;
    amount = Math.min(100, Math.floor(amount));

    // 既に今日押していれば弾く
    const { hash: ipHash } = getRequestFingerprint(req);
    const since = startOfTodayJSTUtc();
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
      prisma.supportEvent.create({ data: { videoId, amount, ipHash } }),
      prisma.video.update({ where: { id: videoId }, data: { supportPoints: { increment: amount } } }),
    ]);

    const v = await prisma.video.findUnique({
      where: { id: videoId },
      select: { supportPoints: true },
    });

    return Response.json({ ok: true, points: v?.supportPoints ?? amount });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
