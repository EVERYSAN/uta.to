// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ========== 型定義（フル） ========== */
type IngestStep =
  | { ok: true; skipped: boolean; added: number; updated: number }
  | { ok: false; error: string };

type WindowStat = { updatedViaJoin: number; zeroFilled: number };

type RecomputeHas = {
  supportCount: boolean;
  supportTotal: boolean;   // ある環境ではこの列名を使用
  supportPoints: boolean;  // ある環境ではこの列名を使用
  support1d: boolean;
  support7d: boolean;
  support30d: boolean;
  sePointsColumn: boolean; // SupportEvent に points 列があるか
};

type RecomputeStep =
  | {
      ok: true;
      has: RecomputeHas;
      totals?: {
        updatedViaJoin: number;
        zeroFilled: number;
        setExprForCount: string;
        setExprForPoints: string;
      };
      windows?: {
        d1?: WindowStat;
        d7?: WindowStat;
        d30?: WindowStat;
      };
    }
  | { ok: false; error: string };

type RebuildStep =
  | { ok: true; skipped: boolean }
  | { ok: false; error: string };

type RevalidateStep = { ok: true } | { ok: false; error: string };

type Result = {
  ok: boolean;
  env: "production" | "preview" | "development" | "unknown";
  dryRun: boolean;
  startedAt: string;
  finishedAt?: string;
  steps: {
    ingest: IngestStep;
    recomputeSupport: RecomputeStep;
    rebuildSearch: RebuildStep;
    revalidate: RevalidateStep;
  };
};

/* ========== ユーティリティ ========== */
const ENV: Result["env"] =
  (process.env.VERCEL_ENV as any) ||
  (process.env.NODE_ENV as any) ||
  "unknown";

function pickSecretFrom(req: Request): string | undefined {
  const u = new URL(req.url);
  const qs = u.searchParams.get("secret") ?? undefined;
  const hdr =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("x-cron-secret") ||
    undefined;
  return qs || hdr;
}

function resolveExpectedSecret(): string | undefined {
  // 環境ごとに使い分け可。なければ CRON_SECRET を共通で使用。
  if (ENV === "production" && process.env.CRON_SECRET_PROD) {
    return process.env.CRON_SECRET_PROD;
  }
  if (ENV === "preview" && process.env.CRON_SECRET_PREVIEW) {
    return process.env.CRON_SECRET_PREVIEW;
  }
  return process.env.CRON_SECRET;
}

function requireAuthorized(req: Request) {
  const expected = resolveExpectedSecret();
  if (!expected) throw new Error("CRON_SECRET is not set");
  const got = pickSecretFrom(req);
  if (got !== expected) throw new Error("unauthorized");
}

async function columnExists(table: string, column: string): Promise<boolean> {
  // table は実テーブル名（小文字）。Prisma は "Video" として扱うが information_schema は小文字で保管されることに注意
  // Neon/PG で通常、未クォート作成なら小文字、クォート作成ならそのまま。
  // Prisma のテーブルはクォートで作成されるため、情報スキーマでは小文字になることが多い。
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
    table,
    column
  );
  return !!rows?.[0]?.exists;
}

/** Video 側の合計カラム（存在するものだけ） */
async function detectVideoTotalCols(): Promise<{
  countCol?: "supportCount";
  totalCol?: "supportTotal" | "supportPoints";
}> {
  const hasCount = await columnExists("video", "supportcount").catch(() => false);
  // 片方・または両方存在し得る
  const hasTotal = await columnExists("video", "supporttotal").catch(() => false);
  const hasPoints = await columnExists("video", "supportpoints").catch(() => false);

  return {
    countCol: hasCount ? "supportCount" : undefined,
    totalCol: hasTotal ? "supportTotal" : hasPoints ? "supportPoints" : undefined,
  };
}

async function detectWindows(): Promise<{
  w1d: boolean;
  w7d: boolean;
  w30d: boolean;
}> {
  const w1d = await columnExists("video", "support1d").catch(() => false);
  const w7d = await columnExists("video", "support7d").catch(() => false);
  const w30d = await columnExists("video", "support30d").catch(() => false);
  return { w1d, w7d, w30d };
}

async function detectSEPoints(): Promise<boolean> {
  return columnExists("supportevent", "points").catch(() => false);
}

/** searchVector を持っていれば再構築 */
async function rebuildSearchVector(dryRun: boolean): Promise<boolean> {
  const has = await columnExists("video", "searchvector").catch(() => false);
  if (!has || dryRun) return false;
  await prisma.$executeRawUnsafe(`
    UPDATE "Video" v
    SET "searchVector" = to_tsvector('simple',
      coalesce(v.title, '') || ' ' || coalesce(v."channelTitle", '')
    )
  `);
  return true;
}

/** 合計（全期間）の更新：count/points を列有無・SE.points 有無に合わせて更新 */
async function updateTotals(
  opts: {
    countCol?: "supportCount";
    totalCol?: "supportTotal" | "supportPoints";
    seHasPoints: boolean;
  },
  dryRun: boolean
): Promise<{
  updatedViaJoin: number;
  zeroFilled: number;
  setExprForCount: string;
  setExprForPoints: string;
}> {
  if (dryRun || (!opts.countCol && !opts.totalCol)) {
    return {
      updatedViaJoin: 0,
      zeroFilled: 0,
      setExprForCount: "n/a",
      setExprForPoints: "n/a",
    };
  }

  // SupportEvent 側の集計式
  const exprCount = `COUNT(*)::int`;
  const exprPoints = opts.seHasPoints
    ? `SUM(COALESCE(se.points, 1))::int`
    : `COUNT(*)::int`;

  // CTE で両方出す（必要な側だけ使う）
  const updatedViaJoin = await prisma.$executeRawUnsafe<number>(`
    WITH counts AS (
      SELECT "videoId" AS vid,
             ${exprCount} AS cnt,
             ${exprPoints} AS pts
      FROM "SupportEvent" se
      GROUP BY "videoId"
    )
    UPDATE "Video" v
    SET
      ${opts.countCol ? `"${opts.countCol}" = c.cnt` : `"id" = v.id"`},
      ${opts.totalCol ? `"${opts.totalCol}" = c.pts` : `"id" = v.id"`}
    FROM counts c
    WHERE v.id = c.vid
  `);

  // 0 埋め（全期間でイベント無し）
  const setZeroPieces: string[] = [];
  if (opts.countCol) setZeroPieces.push(`"${opts.countCol}" = 0`);
  if (opts.totalCol) setZeroPieces.push(`"${opts.totalCol}" = 0`);
  const setZero = setZeroPieces.join(", ");

  let zeroFilled = 0;
  if (setZero) {
    zeroFilled = await prisma.$executeRawUnsafe<number>(`
      UPDATE "Video" v
      SET ${setZero}
      WHERE NOT EXISTS (SELECT 1 FROM "SupportEvent" se WHERE se."videoId" = v.id)
    `);
  }

  return {
    updatedViaJoin,
    zeroFilled,
    setExprForCount: exprCount,
    setExprForPoints: exprPoints,
  };
}

/** 期間別（1d/7d/30d）カラムを更新（存在する列だけ） */
async function updateWindow(
  col: "support1d" | "support7d" | "support30d",
  intervalSql: string,
  dryRun: boolean
): Promise<WindowStat> {
  const exists = await columnExists("video", col.toLowerCase()).catch(() => false);
  if (!exists || dryRun) return { updatedViaJoin: 0, zeroFilled: 0 };

  const updatedViaJoin = await prisma.$executeRawUnsafe<number>(`
    WITH counts AS (
      SELECT "videoId" AS vid, COUNT(*)::int AS cnt
      FROM "SupportEvent"
      WHERE "createdAt" >= NOW() - ${intervalSql}
      GROUP BY "videoId"
    )
    UPDATE "Video" v
    SET "${col}" = c.cnt
    FROM counts c
    WHERE v.id = c.vid
  `);

  const zeroFilled = await prisma.$executeRawUnsafe<number>(`
    UPDATE "Video" v
    SET "${col}" = 0
    WHERE NOT EXISTS (
      SELECT 1
      FROM "SupportEvent" se
      WHERE se."videoId" = v.id
        AND se."createdAt" >= NOW() - ${intervalSql}
    )
  `);

  return { updatedViaJoin, zeroFilled };
}

/* ========== ルート本体 ========== */
export async function GET(req: Request) {
  // 認可
  try {
    requireAuthorized(req);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unauthorized" },
      { status: 401 }
    );
  }

  const startedAt = new Date();
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";

  const steps: Result["steps"] = {
    // 取り込み（今は枠のみ。将来的に新着取り込み等を入れる想定）
    ingest: { ok: true, skipped: true, added: 0, updated: 0 },
    recomputeSupport: { ok: false, error: "not-started" },
    rebuildSearch: { ok: true, skipped: true },
    revalidate: { ok: false, error: "not-started" },
  };

  // 1) 合計＆期間別の再計算
  try {
    const seHasPoints = await detectSEPoints();
    const totalsCols = await detectVideoTotalCols();
    const windows = await detectWindows();

    const totals = await updateTotals(
      {
        countCol: totalsCols.countCol,
        totalCol: totalsCols.totalCol,
        seHasPoints,
      },
      dryRun
    );

    const winStat: { d1?: WindowStat; d7?: WindowStat; d30?: WindowStat } = {};
    if (windows.w1d) winStat.d1 = await updateWindow("support1d", `INTERVAL '1 day'`, dryRun);
    if (windows.w7d) winStat.d7 = await updateWindow("support7d", `INTERVAL '7 days'`, dryRun);
    if (windows.w30d) winStat.d30 = await updateWindow("support30d", `INTERVAL '30 days'`, dryRun);

    steps.recomputeSupport = {
      ok: true,
      has: {
        supportCount: !!totalsCols.countCol,
        supportTotal: totalsCols.totalCol === "supportTotal",
        supportPoints: totalsCols.totalCol === "supportPoints",
        support1d: windows.w1d,
        support7d: windows.w7d,
        support30d: windows.w30d,
        sePointsColumn: seHasPoints,
      },
      totals:
        totalsCols.countCol || totalsCols.totalCol
          ? totals
          : undefined,
      windows: winStat,
    };
  } catch (e: any) {
    steps.recomputeSupport = { ok: false, error: e?.message ?? "recompute failed" };
  }

  // 2) searchVector 再構築
  try {
    const did = await rebuildSearchVector(dryRun);
    steps.rebuildSearch = { ok: true, skipped: !did };
  } catch (e: any) {
    steps.rebuildSearch = { ok: false, error: e?.message ?? "rebuild search failed" };
  }

  // 3) ページ再検証
  try {
    // 影響しそうなページ達
    revalidatePath("/");
    revalidatePath("/trending");
    revalidatePath("/search");
    steps.revalidate = { ok: true };
  } catch (e: any) {
    steps.revalidate = { ok: false, error: e?.message ?? "revalidate failed" };
  }

  const body: Result = {
    ok: true,
    env: ENV,
    dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    steps,
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export const POST = GET;
