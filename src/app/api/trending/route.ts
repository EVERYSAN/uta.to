import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
// ↑ prisma のパスはプロジェクトの実体に合わせてください

type RangeKey = "24h" | "7d" | "30d";

function getRange(range: string | null): { from: Date; windowHours: number } {
  const now = new Date();
  switch ((range as RangeKey) ?? "7d") {
    case "24h": {
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return { from, windowHours: 24 };
    }
    case "30d": {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { from, windowHours: 30 * 24 };
    }
    case "7d":
    default: {
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { from, windowHours: 7 * 24 };
    }
  }
}

/** スナップショット1行から各カウントを取り出す（フィールド名の差異に耐える） */
function countsFromSnap(row: any) {
  const hearts =
    Number(row?.hearts ?? row?.heart ?? row?.heartsDelta ?? row?.heartDelta ?? row?.likes ?? 0) || 0;
  const flames =
    Number(row?.flames ?? row?.flame ?? row?.flamesDelta ?? row?.flameDelta ?? row?.fires ?? 0) || 0;
  const supporters =
    Number(
      row?.supporters ??
        row?.support ??
        row?.supportersDelta ??
        row?.supportDelta ??
        row?.cheers ??
        row?.boosts ??
        0
    ) || 0;

  return { hearts, flames, supporters };
}

function supportScore(sum: { hearts: number; flames: number; supporters: number }) {
  // 重み付けは従来通り：❤️=1, 🔥=2, 応援=3
  return sum.hearts + 2 * sum.flames + 3 * sum.supporters;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const range = (searchParams.get("range") as RangeKey) ?? "7d";
  const sort = (searchParams.get("sort") ?? "trending") as "trending" | "support";
  const longOnly =
    ["1", "true", "yes"].includes((searchParams.get("long") || "").toLowerCase()) ||
    ["long", "1"].includes((searchParams.get("type") || "").toLowerCase());
  const excludeShorts = (searchParams.get("shorts") || "").toLowerCase() === "exclude";

  const { from, windowHours } = getRange(range);

  // Video 側のフィルタを relation 経由で適用
  const videoAND: any[] = [];
  if (longOnly) videoAND.push({ durationSec: { gte: 61 } });
  if (excludeShorts) videoAND.push({ NOT: { url: { contains: "/shorts/" } } });

  // SupportSnapshot を時間範囲で取得（select は付けずにスキーマ差異を回避）
  const snapshots = await prisma.supportSnapshot.findMany({
    where: {
      createdAt: { gte: from },
      ...(videoAND.length ? { video: { AND: videoAND } } : {}),
    },
  });

  // もしスナップショットが0なら、空表示を避けるため期間内の新着を返す
  if (snapshots.length === 0) {
    const fallback = await prisma.video.findMany({
      where: {
        AND: [
          { publishedAt: { gte: from } },
          ...(videoAND.length ? videoAND : []),
        ],
      },
      select: {
        id: true,
        title: true,
        url: true,
        thumbnailUrl: true,
        channelTitle: true,
        publishedAt: true,
        durationSec: true,
      },
      orderBy: { publishedAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ ok: true, list: fallback });
  }

  // videoId ごとに加算
  const sums: Record<string, { hearts: number; flames: number; supporters: number }> = {};
  for (const row of snapshots as any[]) {
    const id = String(row.videoId);
    const c = countsFromSnap(row);
    const cur = sums[id] || { hearts: 0, flames: 0, supporters: 0 };
    cur.hearts += c.hearts;
    cur.flames += c.flames;
    cur.supporters += c.supporters;
    sums[id] = cur;
  }

  const ids = Object.keys(sums);
  if (ids.length === 0) return NextResponse.json({ ok: true, list: [] });

  // 表示用の Video 情報を取得
  const videos = await prisma.video.findMany({
    where: {
      id: { in: ids },
      ...(videoAND.length ? { AND: videoAND } : {}),
    },
    select: {
      id: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      channelTitle: true,
      publishedAt: true,
      durationSec: true,
    },
  });

  const now = new Date();
  const rows = videos.map((v) => {
    const sum = sums[v.id];
    const support = supportScore(sum);
    const hours = Math.max(
      1,
      (now.getTime() - (v.publishedAt ? new Date(v.publishedAt).getTime() : now.getTime())) /
        3_600_000
    );

    // 急上昇：時間減衰＋ロング微ブースト
    const trendScore =
      support / Math.pow(hours / windowHours, 0.35) + (v.durationSec && v.durationSec >= 61 ? support * 0.05 : 0);

    return {
      ...v,
      hearts: sum.hearts,
      flames: sum.flames,
      supporters: sum.supporters,
      support,
      trendScore,
    };
  });

  rows.sort((a, b) => (sort === "support" ? b.support - a.support : b.trendScore - a.trendScore));

  return NextResponse.json({ ok: true, list: rows.slice(0, 50) });
}
