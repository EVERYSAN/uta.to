// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/** utils **/
const parseIntFromQuery = (v: string | null, def: number) => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
};
const now = () => new Date();
const fromByRange = (range: "1d" | "7d" | "30d") => {
  const d = now();
  if (range === "1d") d.setHours(d.getHours() - 24);
  else if (range === "7d") d.setDate(d.getDate() - 7);
  else d.setDate(d.getDate() - 30);
  return d;
};
const isShortByMeta = (v: { url: string | null; durationSec: number | null }) => {
  const shortUrl = v.url?.includes("/shorts/") === true;
  const byDuration = typeof v.durationSec === "number" && v.durationSec <= 60;
  return shortUrl || byDuration;
};
const isLongByMeta = (v: { url: string | null; durationSec: number | null }) =>
  !isShortByMeta(v) && (v.durationSec == null || v.durationSec >= 61);

/** 動的に SupportSnapshot の合計式を作る */
function buildSupportSumExpr(): { expr: string; hasAny: boolean } {
  const ss = (Prisma as any).dmmf?.datamodel?.models?.find(
    (m: any) => m.name === "SupportSnapshot"
  );
  const names: string[] = ss?.fields?.map((f: any) => f.name) ?? [];

  // まず候補名を優先順で探す
  const pick = (cands: string[]) => cands.find((n) => names.includes(n));

  const cols: string[] = [];
  const addIf = (n?: string) => n && cols.push(`COALESCE("${n}",0)`);

  // よく使う名前群（どれが存在していてもOK）
  addIf(pick(["hearts", "heart", "heartCount", "heart_points", "supportHearts"]));
  addIf(pick(["flames", "flame", "flameCount", "flame_points", "supportFlames"]));
  addIf(pick(["supporters", "supporterCount", "support_count"]));

  // もし個別カラムが無ければ、総合ポイントっぽい名前を探す
  if (cols.length === 0) {
    addIf(pick(["points", "score", "supportPoints", "total", "value"]));
  }

  if (cols.length === 0) {
    // 何も分からない場合は 0 固定（SQL が壊れないように）
    return { expr: "0", hasAny: false };
  }
  return { expr: cols.join(" + "), hasAny: true };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = parseIntFromQuery(url.searchParams.get("page"), 1);
  const take = Math.min(parseIntFromQuery(url.searchParams.get("take"), 24), 48);
  const range = (url.searchParams.get("range") as "1d" | "7d" | "30d") || "1d";
  const shorts = (url.searchParams.get("shorts") as "exclude" | "all") || "exclude";
  const sort = (url.searchParams.get("sort") as "trending" | "points") || "trending";

  const from = fromByRange(range);
  const offset = (page - 1) * take;

  /** 期間内の応援ポイントを videoId ごとに合計（存在するカラム名で自動） */
  const { expr: sumExpr, hasAny } = buildSupportSumExpr();

  let pointsRows: { videoId: string; points: number }[] = [];
  if (hasAny) {
    // 動的 SQL（安全のためカラム名は DMMF から拾った既知名のみ）
    const sql = `
      SELECT "videoId", SUM(${sumExpr}) AS points
      FROM "SupportSnapshot"
      WHERE "createdAt" >= $1
      GROUP BY "videoId"
      ORDER BY points DESC
    `;
    pointsRows = await prisma.$queryRawUnsafe(sql, from);
  }

  // videoId -> 期間内応援ポイント
  const pointsMap = new Map<string, number>();
  for (const r of pointsRows) pointsMap.set(String(r.videoId), Number(r.points) || 0);

  // まずは「応援がある動画」を優先候補に（十分に多い場合はこの中からページング）
  let candidateIds = pointsRows.map((r) => String(r.videoId));

  // 24h などで応援が少ない/ゼロなら、期間内の新着からフォールバックで補完
  if (candidateIds.length < offset + take) {
    const need = offset + take - candidateIds.length + 50; // ちょい多め
    const extra = await prisma.video.findMany({
      where: {
        publishedAt: { gte: from },
        ...(shorts === "exclude"
          ? {
              OR: [
                { durationSec: { gte: 61 } },
                { durationSec: null },
                { url: { not: { contains: "/shorts/" } } },
                { url: { equals: null } },
              ],
            }
          : {}),
      },
      orderBy: [{ publishedAt: "desc" as const }, { likes: "desc" as const }],
      select: { id: true },
      take: need,
    });
    for (const v of extra) {
      if (!candidateIds.includes(v.id)) candidateIds.push(v.id);
    }
  }

  // ページング対象の ID を決定
  const pageIds = candidateIds.slice(offset, offset + take);
  if (pageIds.length === 0) {
    return NextResponse.json({ ok: true, items: [], page, take, total: 0 });
  }

  // 実データを取得
  const videos = await prisma.video.findMany({
    where: { id: { in: pageIds } },
    select: {
      id: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      durationSec: true,
      publishedAt: true,
      channelTitle: true,
      views: true,
      likes: true,
    },
  });

  // 並び順（points / trending）を最終決定
  const nowTs = Date.now();
  const longBoost = (v: any) => (isLongByMeta(v) ? 1.05 : 1); // ロングは微ブースト
  const list = videos.map((v) => {
    const support = pointsMap.get(v.id) ?? 0;
    const hours =
      typeof v.publishedAt === "string" || v.publishedAt instanceof Date
        ? Math.max(1, (nowTs - new Date(v.publishedAt as any).getTime()) / 3_600_000)
        : 24;

    // 急上昇スコア：期間内応援 ÷ 時間減衰（新しいほど強い）
    const trendingScore = support / Math.pow(hours / 24, 0.35) * longBoost(v);

    return {
      ...v,
      supportInRange: support,
      _score: sort === "points" ? support : trendingScore,
    };
  });

  // 指定の ID 順が崩れないように一度 indexMap を作って tie-breaker に使う
  const idxMap = new Map(pageIds.map((id, i) => [id, i]));
  list.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    // スコア同点時は points > views > likes > 元の順
    const pa = pointsMap.get(a.id) ?? 0;
    const pb = pointsMap.get(b.id) ?? 0;
    if (pb !== pa) return pb - pa;
    if ((b.views ?? 0) !== (a.views ?? 0)) return (b.views ?? 0) - (a.views ?? 0);
    if ((b.likes ?? 0) !== (a.likes ?? 0)) return (b.likes ?? 0) - (a.likes ?? 0);
    return (idxMap.get(a.id) ?? 0) - (idxMap.get(b.id) ?? 0);
  });

  // ランク番号（ページングに合わせる）
  const items = list.map((v, i) => ({
    id: v.id,
    title: v.title,
    url: v.url,
    thumbnailUrl: v.thumbnailUrl,
    durationSec: v.durationSec,
    publishedAt:
      typeof v.publishedAt === "string"
        ? v.publishedAt
        : v.publishedAt
        ? (v.publishedAt as Date).toISOString()
        : null,
    channelTitle: v.channelTitle,
    views: v.views,
    likes: v.likes,
    supportInRange: v.supportInRange,
    trendingRank: offset + i + 1,
  }));

  return NextResponse.json({ ok: true, items, page, take });
}
