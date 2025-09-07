// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ========== 型定義（省略なし） ========== */
type IngestStep =
  | { ok: true; skipped: boolean; added: number; updated: number }
  | { ok: false; error: string };

type RecomputeHas = {
  supportCount: boolean;
  supportTotal: boolean;
  supportPoints: boolean;
  support1d: boolean;
  support7d: boolean;
  support30d: boolean;
};
type WindowStat = { updatedViaJoin: number; zeroFilled: number };

type RecomputeStep =
  | {
      ok: true;
      totals?: WindowStat;
      has: RecomputeHas;
      windows?: { d1?: WindowStat; d7?: WindowStat; d30?: WindowStat };
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

const ENV =
  (process.env.VERCEL_ENV as Result["env"]) ||
  (process.env.NODE_ENV as Result["env"]) ||
  "unknown";

/* ========== ユーティリティ ========== */
function pickSecretFrom(req: Request): string | undefined {
  const u = new URL(req.url);
  const qs = u.searchParams.get("secret") ?? undefined;
  const hdr =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("x-cron-secret") ||
    undefined;
  return qs || hdr;
}

function requireAuthorized(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) throw new Error("CRON_SECRET is not set");
  const got = pickSecretFrom(req);
  if (got !== expected) throw new Error("unauthorized");
}

async function columnExists(table: string, column: string): Promise<boolean> {
  // Prisma の quoted 識別子（"Video" / "SupportEvent"）前提で information_schema を参照
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

/* 合計カラム群（存在するものだけ更新対象にする） */
async function detectTotalCols(): Promise<string[]> {
  const candidates = ["supportCount", "supportTotal", "supportPoints"];
  const exists: string[] = [];
  for (const c of candidates) {
    if (await columnExists("Video", c)) exists.push(c);
  }
  return exists;
}

/* SET 句を安全に組み立て（固定配列からのみ生成） */
function setClause(cols: string[], rhsExpr: string): string {
  return cols.map((c) => `"${c}" = ${rhsExpr}`).join(", ");
}

/* 合計（SupportEvent 全期間）の更新 */
async function updateTotals(cols: string[], dryRun: boolean): Promise<WindowStat> {
  if (cols.length === 0 || dryRun) return { updatedViaJoin: 0, zeroFilled: 0 };

  const setJoin = setClause(cols, "c.cnt");
  const setZero = setClause(cols, "0");

  const updatedViaJoin = await prisma.$executeRawUnsafe<number>(`
    WITH counts AS (
      SELECT "videoId", COUNT(*)::int AS cnt
      FROM "SupportEvent"
      GROUP BY "videoId"
    )
    UPDATE "Video" AS v
    SET ${setJoin}
    FROM counts c
    WHERE v.id = c."videoId"
  `);

  const zeroFilled = await prisma.$executeRawUnsafe<number>(`
    UPDATE "Video" AS v
    SET ${setZero}
    WHERE NOT EXISTS (
      SELECT 1 FROM "SupportEvent" se WHERE se."videoId" = v.id
    )
  `);

  return { updatedViaJoin, zeroFilled };
}

/* 期間別（1d/7d/30d）を 1 列ずつ更新 */
async function updateWindow(
  col: "support1d" | "support7d" | "support30d",
  intervalSql: string,
  dryRun: boolean
): Promise<WindowStat> {
  if (!(await columnExists("Video", col)) || dryRun)
    return { updatedViaJoin: 0, zeroFilled: 0 };

  const updatedViaJoin = await prisma.$executeRawUnsafe<number>(`
    WITH counts AS (
      SELECT "videoId", COUNT(*)::int AS cnt
      FROM "SupportEvent"
      WHERE "createdAt" >= NOW() - ${intervalSql}
      GROUP BY "videoId"
    )
    UPDATE "Video" AS v
    SET "${col}" = c.cnt
    FROM counts c
    WHERE v.id = c."videoId"
  `);

  const zeroFilled = await prisma.$executeRawUnsafe<number>(`
    UPDATE "Video" AS v
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

/* searchVector の再構築 */
async function rebuildSearchVector(dryRun: boolean): Promise<boolean> {
  const has = await columnExists("Video", "searchVector");
  if (!has || dryRun) return false;

  await prisma.$executeRawUnsafe(`
    UPDATE "Video" v
    SET "searchVector" = to_tsvector('simple',
      coalesce(v.title, '') || ' ' || coalesce(v."channelTitle", '')
    )
  `);
  return true;
}

/* ========== ハンドラ本体 ========== */
export async function GET(req: Request) {
  // 認証
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

  // レスポンス雛形（型安全に直書き）
  const steps: Result["steps"] = {
    ingest: { ok: true, skipped: true, added: 0, updated: 0 }, // 取り込みは将来拡張
    recomputeSupport: { ok: false, error: "not-started" },
    rebuildSearch: { ok: true, skipped: true },
    revalidate: { ok: false, error: "not-started" },
  };

  // 1) 合計 & 期間別の再計算
  try {
    // どのカラムが存在するかを確認
    const totalCols = await detectTotalCols();
    const has1d = await columnExists("Video", "support1d");
    const has7d = await columnExists("Video", "support7d");
    const has30d = await columnExists("Video", "support30d");

    // 合計の更新
    const totals = await updateTotals(totalCols, dryRun);

    // 期間別の更新
    const windows: { d1?: WindowStat; d7?: WindowStat; d30?: WindowStat } = {};
    if (has1d) windows.d1 = await updateWindow("support1d", `INTERVAL '1 day'`, dryRun);
    if (has7d) windows.d7 = await updateWindow("support7d", `INTERVAL '7 days'`, dryRun);
    if (has30d) windows.d30 = await updateWindow("support30d", `INTERVAL '30 days'`, dryRun);

    steps.recomputeSupport = {
      ok: true,
      totals: totalCols.length ? totals : undefined,
      has: {
        supportCount: totalCols.includes("supportCount"),
        supportTotal: totalCols.includes("supportTotal"),
        supportPoints: totalCols.includes("supportPoints"),
        support1d: has1d,
        support7d: has7d,
        support30d: has30d,
      },
      windows,
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
