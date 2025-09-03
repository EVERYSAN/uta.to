// src/app/api/cron/snapshot/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { floorToHourUtc, subHours } from "@/lib/support";

export const dynamic = "force-dynamic";      // Cron実行時の安定化
export const runtime = "nodejs";             // PrismaのためEdgeではなくNode

function authOk(req: Request) {
  const token = process.env.CRON_SECRET;
  if (!token) return true; // 未設定なら無認証で許可
  const url = new URL(req.url);
  const q = url.searchParams.get("token");
  const h = req.headers.get("authorization");
  return q === token || h === `Bearer ${token}`;
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // [prevHour, currentHour)
  const currentHour = floorToHourUtc(new Date());
  const prevHour = subHours(currentHour, 1);

  // この1時間での応援を動画ごとに集計
  const groups = await prisma.supportEvent.groupBy({
    by: ["videoId"],
    where: { createdAt: { gte: prevHour, lt: currentHour } },
    _sum: { amount: true },
  });

  let upserts = 0;
  for (const g of groups) {
    const amount = g._sum.amount ?? 0;
    if (amount <= 0) continue;
    await prisma.supportSnapshot.upsert({
      where: { videoId_hourStart: { videoId: g.videoId, hourStart: prevHour } },
      create: { videoId: g.videoId, hourStart: prevHour, amount },
      update: { amount },
    });
    upserts++;
  }

  // 古いスナップショットを整理（40日より前を削除）
  const cut = subHours(currentHour, 40 * 24);
  await prisma.supportSnapshot.deleteMany({ where: { hourStart: { lt: cut } } });

  return NextResponse.json({
    ok: true,
    from: prevHour.toISOString(),
    to: currentHour.toISOString(),
    groups: groups.length,
    upserts,
  });
}
