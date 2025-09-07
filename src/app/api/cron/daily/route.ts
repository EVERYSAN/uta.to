// src/app/api/cron/daily/route.ts
import { NextResponse, NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────
// 重要フラグ：ビルド時の静的化を禁止（request.url を読んでも安全）
// ─────────────────────────────────────────────────────────────
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 認可：Vercel Cron or secret or Authorization: Bearer
function authorize(req: NextRequest) {
  const headerCron = req.headers.get("x-vercel-cron");
  if (headerCron) return true;

  const url = new URL(req.url);
  const qsSecret = url.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET;
  if (qsSecret && envSecret && qsSecret === envSecret) return true;

  const auth = req.headers.get("authorization");
  if (auth && envSecret && auth === `Bearer ${envSecret}`) return true;

  return false;
}

// DBカラムの存在チェック（Quoted テーブル名に注意：Prisma は "Video" など大文字）
async function columnExists(table: string, column: string) {
  // information_schema は小文字で管理されるので、クオートされた識別子に合わせて検索
  const rows = await prisma.$queryRaw<
    Array<{ exists: boolean }>
  >`SELECT EXISTS(
       SELECT 1 FROM information_schema.columns 
       WHERE table_schema = 'public' 
         AND table_name = ${table}
         AND column_name = ${column}
     ) AS "exists"`;
  return rows[0]?.exists === true;
}

// 取り込み（任意）：環境変数があれば実行、無ければスキップ
// 例：HARVEST_JSON_URL に {items:[{platformVideoId,title,channelTitle,url,thumbnailUrl,durationSec,publishedAt}]} を返すエンドポイントを渡す
async function ingestNewVideosIfConfigured() {
  const url = process.env.HARVEST_JSON_URL;
  if (!url) return { ok: true, skipped: true, added: 0, updated: 0 };

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, skipped: false, error: `fetch ${res.status}` };
    }
    const data = await res.json();
    const items: any[] = Array.isArray(data?.items) ? data.items : [];

    let added = 0;
    let updated = 0;

    // ベーシックな upsert。platform は youtube 固定（必要に応じて改造）
    for (const it of items) {
      const platformVideoId: string | undefined = it.platformVideoId ?? it.id;
      if (!platformVideoId) continue;

      const publishedAt =
        it.publishedAt ? new Date(it.publishedAt) : new Date();

      await prisma.video
        .upsert({
          where: { platform_platformVideoId: { platform: "youtube", platformVideoId } },
          create: {
            platform: "youtube",
            platformVideoId,
            title: it.title ?? "(no title)",
            channelTitle: it.channelTitle ?? "(unknown)",
            url: it.url ?? `https://www.youtube.com/watch?v=${platformVideoId}`,
            thumbnailUrl: it.thumbnailUrl ?? null,
            durationSec:
              typeof it.durationSec === "number" ? it.durationSec : null,
            publishedAt,
            views: typeof it.views === "number" ? it.views : 0,
            likes: typeof it.likes === "number" ? it.likes : 0,
          },
          update: {
            title: it.title ?? undefined,
            channelTitle: it.channelTitle ?? undefined,
            url: it.url ?? undefined,
            thumbnailUrl: it.thumbnailUrl ?? undefined,
            durationSec:
              typeof it.durationSec === "number" ? it.durationSec : undefined,
            publishedAt,
            views: typeof it.views === "number" ? it.views : undefined,
            likes: typeof it.likes === "number" ? it.likes : undefined,
          },
          select: { id: true },
        })
        .then((r) => {
          // upsert の結果から新規/更新は判定しにくいので軽く存在チェック
          if (r) updated += 1;
        })
        .catch((e) => {
          // 競合などは握りつぶして続行
          console.error("upsert video error:", e);
        });
    }

    // 新規件数をざっくり計るなら、items 長 - 更新数 だが、ここでは updated を総件数として返す
    added = Math.max(0, items.length - updated);
    return { ok: true, skipped: false, added, updated };
  } catch (e: any) {
    return { ok: false, skipped: false, error: String(e?.message ?? e) };
  }
}

// 応援の再集計：累計＋ 1d/7d/30d（該当カラムが無いなら自動スキップ）
async function recomputeSupportCounters() {
  const hasTotal = await columnExists("Video", "supporttotal"); // Postgres は列名小文字比較
  const has1d = await columnExists("Video", "support1d");
  const has7d = await columnExists("Video", "support7d");
  const has30d = await columnExists("Video", "support30d");

  // groupBy helper
  const groupCount = async (since?: Date) => {
    const where = since ? { createdAt: { gte: since } } : {};
    const grouped = await prisma.supportEvent.groupBy({
      by: ["videoId"],
      where,
      _count: { videoId: true }, // ← TypeScript 的にも OK（_all は orderBy に使えない）
      orderBy: { _count: { videoId: "desc" } },
    });
    // Map<videoId, count>
    return new Map(grouped.map((g) => [g.videoId, g._count?.videoId ?? 0]));
  };

  const now = Date.now();
  const d1 = new Date(now - 24 * 60 * 60 * 1000);
  const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const totalMap = hasTotal ? await groupCount() : new Map<string, number>();
  const m1 = has1d ? await groupCount(d1) : new Map<string, number>();
  const m7 = has7d ? await groupCount(d7) : new Map<string, number>();
  const m30 = has30d ? await groupCount(d30) : new Map<string, number>();

  // 更新対象 videoId の集合
  const ids = new Set<string>([
    ...totalMap.keys(),
    ...m1.keys(),
    ...m7.keys(),
    ...m30.keys(),
  ]);
  let updatedRows = 0;

  // 大量更新になり得るので、トランザクション＋並列は控えめ
  await prisma.$transaction(
    async (tx) => {
      for (const id of ids) {
        const data: any = {};
        if (hasTotal) data.supportTotal = totalMap.get(id) ?? 0;
        if (has1d) data.support1d = m1.get(id) ?? 0;
        if (has7d) data.support7d = m7.get(id) ?? 0;
        if (has30d) data.support30d = m30.get(id) ?? 0;

        try {
          await tx.video.update({
            where: { id },
            data,
            select: { id: true },
          });
          updatedRows++;
        } catch (e) {
          // 既に消えた videoId などはスキップ
        }
      }
    },
    { timeout: 60_000 }
  );

  return {
    ok: true,
    updatedRows,
    columns: {
      supportTotal: hasTotal,
      support1d: has1d,
      support7d: has7d,
      support30d: has30d,
    },
  };
}

// 検索用テキストの同期（任意）：title + channelTitle を search_text に格納する等
async function rebuildSearchTextIfExists() {
  const hasSearch = await columnExists("Video", "search_text");
  if (!hasSearch) return { ok: true, skipped: true };

  // 適当な同義：COALESCE(title,'') || ' ' || COALESCE(channelTitle,'')
  try {
    // 全件更新は重いので、「空 or null だけ更新」に留める
    await prisma.$executeRawUnsafe(`
      UPDATE "Video"
         SET "search_text" = TRIM(COALESCE("title",'') || ' ' || COALESCE("channelTitle",''))
       WHERE "search_text" IS NULL OR "search_text" = '';
    `);
    return { ok: true, skipped: false };
  } catch (e: any) {
    return { ok: false, skipped: false, error: String(e?.message ?? e) };
  }
}

// 必要ページの再検証（ISR/SSG を使っていなくても無害）
async function revalidateAll() {
  try {
    revalidatePath("/");            // ホーム
    revalidatePath("/trending");    // 急上昇
    revalidatePath("/search");      // 検索
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();

  // 1) 取り込み（任意：環境変数で有効化）
  const ingestRes = await ingestNewVideosIfConfigured();

  // 2) 応援の再集計（累計＋レンジ）
  const supportRes = await recomputeSupportCounters();

  // 3) 検索用テキスト再構築（任意）
  const searchRes = await rebuildSearchTextIfExists();

  // 4) ページ再検証
  const revalRes = await revalidateAll();

  const finishedAt = new Date().toISOString();

  return NextResponse.json(
    {
      ok: true,
      startedAt,
      finishedAt,
      steps: {
        ingest: ingestRes,
        recomputeSupport: supportRes,
        rebuildSearch: searchRes,
        revalidate: revalRes,
      },
    },
    {
      headers: {
        // 念のためキャッシュさせない
        "Cache-Control": "no-store",
      },
    }
  );
}
