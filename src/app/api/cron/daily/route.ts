// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Step<T extends object = {}> =
  | ({ ok: true } & T)
  | ({ ok: false; error: string });

type Steps = {
  ingest: Step<{ skipped: boolean; added: number; updated: number }>;
  recomputeSupport: Step<{
    totals: { updatedViaJoin: number; zeroFilled: number };
    has: {
      supportCount: boolean;
      supportPoints: boolean;
      support1d: boolean;
      support7d: boolean;
      support30d: boolean;
    };
    windows?: {
      d1?: { updatedViaJoin: number; zeroFilled: number };
      d7?: { updatedViaJoin: number; zeroFilled: number };
      d30?: { updatedViaJoin: number; zeroFilled: number };
    };
  }>;
  rebuildSearch: Step<{ skipped: boolean }>;
  revalidate: Step<{}>;
};

type Result = {
  ok: boolean;
  env: "production" | "preview" | "development" | "unknown";
  dryRun: boolean;
  startedAt: string;
  finishedAt?: string;
  steps: Steps;
};

function ok<T extends object>(extra?: T) {
  return ({ ok: true, ...(extra ?? {}) }) as const;
}
function err(message: string) {
  return { ok: false as const, error: message };
}

function getSecretFrom(req: Request) {
  const u = new URL(req.url);
  const qs = u.searchParams.get("secret") ?? undefined;
  const hdr =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("x-cron-secret") ||
    undefined;
  return qs || hdr;
}

function assertAuthorized(req: Request) {
  const want = process.env.CRON_SECRET;
  if (!want) throw new Error("CRON_SECRET is not set");
  const got = getSecretFrom(req);
  if (got !== want) throw new Error("unauthorized");
}

const ENV =
  (process.env.VERCEL_ENV as Result["env"]) ||
  (process.env.NODE_ENV as Result["env"]) ||
  "unknown";

async function columnExists(table: string, column: string): Promise<boolean> {
  // Prisma は大文字のテーブル名を "Video" のように **引用符付き** で作るので information_schema も同名です
  const rows = await prisma.$queryRawUnsafe<
    { exists: boolean }[]
  >(
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

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS exists
  `,
    table
  );
  return !!rows?.[0]?.exists;
}

export async function GET(req: Request) {
  // 認証
  try {
    assertAuthorized(req);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";

  const steps: Steps = {
    ingest: ok({ skipped: true, added: 0, updated: 0 }), // 将来の取り込み枠（今回はスキップ）
    recomputeSupport: err("not-started"),
    rebuildSearch: ok({ skipped: true }), // 検索用カラム/テーブルがなければスキップ
    revalidate: err("not-started"),
  };

  // ---------------------------
  // 1) Support 再計算（合計）
  // ---------------------------
  try {
    const hasSupportCount = await columnExists("Video", "supportCount");
    const hasSupportPoints = await columnExists("Video", "supportPoints");

    // 期間別（存在すれば更新）
    const has1d = await columnExists("Video", "support1d");
    const has7d = await columnExists("Video", "support7d");
    const has30d = await columnExists("Video", "support30d");

    const hasAnyTotal = hasSupportCount || hasSupportPoints;

    let updatedViaJoin = 0;
    let zeroFilled = 0;

    if (hasAnyTotal && !dryRun) {
      // SupportEvent 全体件数 → Video.supportCount / supportPoints
      updatedViaJoin = await prisma.$executeRawUnsafe<number>(`
        WITH counts AS (
          SELECT "videoId", COUNT(*)::int AS cnt
          FROM "SupportEvent"
          GROUP BY "videoId"
        )
        UPDATE "Video" AS v
        SET
          ${hasSupportCount ? `"supportCount" = c.cnt` : `"id" = v.id"`},
          ${hasSupportPoints ? `"supportPoints" = c.cnt` : `"id" = v.id" /* no-op */`}
        FROM counts c
        WHERE v.id = c."videoId"
      `);

      zeroFilled = await prisma.$executeRawUnsafe<number>(`
        UPDATE "Video" AS v
        SET
          ${hasSupportCount ? `"supportCount" = 0` : `"id" = v.id"`},
          ${hasSupportPoints ? `"supportPoints" = 0` : `"id" = v.id" /* no-op */"}
        WHERE NOT EXISTS (
          SELECT 1 FROM "SupportEvent" se WHERE se."videoId" = v.id
        )
      `);
    }

    // 期間別ウィンドウ（列が存在する時だけ）
    const windows: Steps["recomputeSupport"]["windows"] = {};
    async function updateWindow(col: "support1d" | "support7d" | "support30d", intervalSql: string) {
      if (!(await columnExists("Video", col))) return { updatedViaJoin: 0, zeroFilled: 0 };

      if (dryRun) return { updatedViaJoin: 0, zeroFilled: 0 };

      const u = await prisma.$executeRawUnsafe<number>(`
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

      const z = await prisma.$executeRawUnsafe<number>(`
        UPDATE "Video" AS v
        SET "${col}" = 0
        WHERE NOT EXISTS (
          SELECT 1 FROM "SupportEvent" se
          WHERE se."videoId" = v.id
            AND se."createdAt" >= NOW() - ${intervalSql}
        )
      `);

      return { updatedViaJoin: u, zeroFilled: z };
    }

    if (has1d) windows.d1 = await updateWindow("support1d", `INTERVAL '1 day'`);
    if (has7d) windows.d7 = await updateWindow("support7d", `INTERVAL '7 days'`);
    if (has30d) windows.d30 = await updateWindow("support30d", `INTERVAL '30 days'`);

    steps.recomputeSupport = ok({
      totals: { updatedViaJoin, zeroFilled },
      has: {
        supportCount: hasSupportCount,
        supportPoints: hasSupportPoints,
        support1d: has1d,
        support7d: has7d,
        support30d: has30d,
      },
      windows,
    });
  } catch (e: any) {
    steps.recomputeSupport = err(e?.message ?? "recompute failed");
  }

  // ---------------------------------
  // 2) 検索用の再構築（あれば）
  //    - 例: Video.searchVector があれば to_tsvector で更新
  // ---------------------------------
  try {
    const hasSearchVector = await columnExists("Video", "searchVector");
    if (hasSearchVector && !dryRun) {
      // extension や辞書は環境ごとに異なるので simple を既定に
      await prisma.$executeRawUnsafe(`
        UPDATE "Video" v
        SET "searchVector" = to_tsvector('simple',
          coalesce(v.title, '') || ' ' ||
          coalesce(v."channelTitle", '')
        )
      `);
      steps.rebuildSearch = ok({ skipped: false });
    } else {
      steps.rebuildSearch = ok({ skipped: true });
    }
  } catch (e: any) {
    steps.rebuildSearch = err(e?.message ?? "rebuild search failed");
  }

  // ---------------------------------
  // 3) 再検証（ISR/SSG の更新トリガ）
  // ---------------------------------
  try {
    // 主要ページ
    revalidatePath("/");
    revalidatePath("/trending");
    // 検索ページは CSR/SR mix なら不要だが、必要に応じて追加可
    steps.revalidate = ok({});
  } catch (e: any) {
    steps.revalidate = err(e?.message ?? "revalidate failed");
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

// 手動 POST 実行にも対応
export const POST = GET;
