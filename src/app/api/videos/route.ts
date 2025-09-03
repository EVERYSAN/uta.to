// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { floorToHourUtc, subHours } from "@/lib/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SortKey = "hot" | "support" | "publishedAt";

const HOUR_MS = 3600_000;

function parseBool(v: string | null | undefined) {
  return v === "1" || v === "true";
}

function parseIntSafe(v: string | null, d: number) {
  if (!v) return d;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}

function toHours(range: string | null): number {
  switch ((range || "24h").toLowerCase()) {
    case "7d":
      return 24 * 7;
    case "30d":
      return 24 * 30;
    case "24h":
    default:
      return 24;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // ---- query params -------------------------------------------------------
    const q = (url.searchParams.get("q") || "").trim();
    const rangeParam = url.searchParams.get("range"); // 24h | 7d | 30d
    const hoursParam = url.searchParams.get("hours"); // 任意の時間数（優先）
    const sortParam = (url.searchParams.get("sort") || "hot") as SortKey; // hot | support | publishedAt

    // UIは「ロング動画」トグル。互換で noShorts=1 も受ける
    const longOnly =
      parseBool(url.searchParams.get("longOnly")) ||
      parseBool(url.searchParams.get("noShorts"));

    const page = Math.max(1, parseIntSafe(url.searchParams.get("page"), 1));
    const limit = Math.min(60, parseIntSafe(url.searchParams.get("limit"), 30)); // 上限は控えめに

    // ---- time window --------------------------------------------------------
    const baseHours = hoursParam ? Math.max(1, parseIntSafe(hoursParam, 24)) : toHours(rangeParam);
    const now = new Date();
    const since = subHours(now, baseHours);

    const sinceHour = floorToHourUtc(since);
    const currentHour = floorToHourUtc(now);

    // ---- base video candidates ---------------------------------------------
    // 集計の対象は時間窓内の動画に限定
    // 取得件数はやや多め（後でメモリ上で並び替え→ページング）
    const where: any = {
      publishedAt: { gte: since },
    };

    if (longOnly) {
      // durationSec >= 60 をロング扱い。durationSec が null は弾く
      where.durationSec = { not: null, gte: 60 };
    }

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { channelTitle: { contains: q, mode: "insensitive" } },
      ];
    }

    const candidates = await prisma.video.findMany({
      where,
      select: {
        id: true,
        platform: true,
        platformVideoId: true,
        title: true,
        channelTitle: true,
        url: true,
        thumbnailUrl: true,
        publishedAt: true,
        durationSec: true,
        views: true,     
        likes: true,
        // あればHot算出に使える。無いなら未使用でもOK
        supportPoints: true,   // 既存の総ポイント（参考）
      },
      orderBy: { publishedAt: "desc" },
      take: 800, // 十分な母集団を確保（プロダクションの件数に応じて調整可）
    });

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        meta: {
          total: 0,
          page,
          limit,
          hours: baseHours,
          sort: sortParam,
          longOnly,
          q,
        },
      });
    }

    const ids = candidates.map((v) => v.id);

    // ---- SupportSnapshot を優先して合算 ------------------------------------
    const pts = new Map<string, number>();

    // 1) スナップショット (sinceHour 以降)
    const snapRows = await prisma.supportSnapshot.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: ids },
        hourStart: { gte: sinceHour },
      },
      _sum: { amount: true },
    });
    for (const r of snapRows) {
      pts.set(r.videoId, (pts.get(r.videoId) ?? 0) + (r._sum.amount ?? 0));
    }

    // 2) 端数A: since ～ sinceHour
    if (since < sinceHour) {
      const headRows = await prisma.supportEvent.groupBy({
        by: ["videoId"],
        where: {
          videoId: { in: ids },
          createdAt: { gte: since, lt: sinceHour },
        },
        _sum: { amount: true },
      });
      for (const r of headRows) {
        pts.set(r.videoId, (pts.get(r.videoId) ?? 0) + (r._sum.amount ?? 0));
      }
    }

    // 3) 端数B: currentHour ～ now
    if (currentHour < now) {
      const tailRows = await prisma.supportEvent.groupBy({
        by: ["videoId"],
        where: {
          videoId: { in: ids },
          createdAt: { gte: currentHour, lt: now },
        },
        _sum: { amount: true },
      });
      for (const r of tailRows) {
        pts.set(r.videoId, (pts.get(r.videoId) ?? 0) + (r._sum.amount ?? 0));
      }
    }

    // ---- Hotスコア（軽量版）：新しさ + 応援の勢い -----------------------------
    // ageHours が小さいほど有利、supportInRange が大きいほど有利。
    // viewCount があれば係数に混ぜてもOK（ここでは必須にしない）
    const scored = candidates.map((v) => {
      const supportInRange = pts.get(v.id) ?? 0;
      const publishedAt = v.publishedAt ?? now;
      const ageHours = Math.max(0.01, (now.getTime() - publishedAt.getTime()) / HOUR_MS);

      // Hot: 単純な減衰 + 応援ブースト
      const hotScore = (supportInRange + 1) / Math.pow(ageHours + 2, 1.5);

      return {
        ...v,
        supportInRange,
        hotScore,
      };
    });

    // ---- 並び替え -----------------------------------------------------------
    let sorted = scored;
    switch (sortParam) {
      case "support":
        sorted = scored.sort((a, b) => {
          if (b.supportInRange !== a.supportInRange) return b.supportInRange - a.supportInRange;
          // 同点は新しい方を上に
          return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
        });
        break;
      case "publishedAt":
        sorted = scored.sort(
          (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
        );
        break;
      case "hot":
      default:
        sorted = scored.sort((a, b) => {
          if (b.hotScore !== a.hotScore) return b.hotScore - a.hotScore;
          return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
        });
        break;
    }

    // ---- ページング ----------------------------------------------------------
    const total = sorted.length;
    const start = (page - 1) * limit;
    const end = Math.min(total, start + limit);
    const pageItems = start < end ? sorted.slice(start, end) : [];

    return NextResponse.json({
      ok: true,
      items: pageItems,
      meta: {
        total,
        page,
        limit,
        hours: baseHours,
        sort: sortParam,
        longOnly,
        q,
      },
    });
  } catch (err: any) {
    console.error("GET /api/videos error", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
