// src/app/api/hero/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ENV はどっちでも読めるよう両対応
function readPinnedIds(): string[] {
  const raw =
    process.env.NEXT_PUBLIC_HERO_PINNED_IDS ??
    process.env.HERO_PINNED_IDS ??
    "";
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET() {
  try {
    const pinnedIds = readPinnedIds();
    const TAKE = 5;

    // 1) ピン留めを取得（順序保持）
    let pinned: any[] = [];
    if (pinnedIds.length > 0) {
      const rows = await prisma.video.findMany({
        where: { id: { in: pinnedIds } },
        select: {
          id: true,
          title: true,
          channelTitle: true,
          thumbnailUrl: true,
          publishedAt: true,
          supportPoints: true,
        },
        // orderBy で任意順はできないので、後で並べ替え
      });
      const map = new Map(rows.map((r) => [r.id, r]));
      pinned = pinnedIds.map((id) => map.get(id)).filter(Boolean);
    }

    // 2) 足りない分を応援ポイント順で補充（重複除外）
    const excludeIds = pinned.map((p) => p.id);
    const need = Math.max(0, TAKE - pinned.length);

    const extra =
      need === 0
        ? []
        : await prisma.video.findMany({
            where: { id: { notIn: excludeIds } },
            orderBy: [
              { supportPoints: "desc" },
              { publishedAt: "desc" },
            ],
            take: need,
            select: {
              id: true,
              title: true,
              channelTitle: true,
              thumbnailUrl: true,
              publishedAt: true,
              supportPoints: true,
            },
          });

    const items = [...pinned, ...extra];

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    console.error("[/api/hero] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "internal_error" },
      { status: 500 }
    );
  }
}
