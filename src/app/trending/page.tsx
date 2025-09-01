import Link from "next/link";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 50;
const MAX_TOTAL = 1000; // ランキング対象を最多1000件に制限（無料枠の負荷対策）

type SearchParams = {
  q?: string;
  range?: "all" | "1d" | "7d" | "30d" | "365d";
  p?: string;
};

// クエリ生成
function makeQuery(base: SearchParams, patch: Partial<SearchParams>) {
  const params = new URLSearchParams();
  const q = (patch.q ?? base.q ?? "").toString();
  const range = (patch.range ?? base.range ?? "7d").toString(); // デフォルト7日
  const p = (patch.p ?? base.p ?? "1").toString();

  if (q) params.set("q", q);
  if (range && range !== "all") params.set("range", range);
  if (p) params.set("p", p);

  const qs = params.toString();
  return qs ? `/trending?${qs}` : "/trending";
}

// 時間減衰つきスコア
function trendingScore(
  views: number | null | undefined,
  likes: number | null | undefined,
  publishedAt: Date
) {
  const v = Math.max(0, views ?? 0);
  const l = Math.max(0, likes ?? 0);
  const hours = Math.max(1, (Date.now() - publishedAt.getTime()) / 36e5);
  // 例: 高評価を重めにしつつ、時間経過で減衰
  return (v + l * 20) / Math.pow(hours + 2, 1.3);
}

export default async function Page({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const q = (searchParams?.q ?? "").trim();
  const range = (searchParams?.range ?? "7d") as NonNullable<SearchParams["range"]>;
  const page = Math.max(1, parseInt(searchParams?.p ?? "1", 10));
  const safePage = page;

  // where（キーワード）
  let where:
    | {
        OR?: any[];
        publishedAt?: { gte?: Date };
        [k: string]: any;
      }
    | undefined =
    q.length > 0
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { channelTitle: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : undefined;

  // 期間フィルタ（ランキング対象の期間）
  if (range !== "all") {
    const daysMap = { "1d": 1, "7d": 7, "30d": 30, "365d": 365 } as const;
    const days = daysMap[range] ?? 0;
    if (days > 0) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      where = { ...(where ?? {}), publishedAt: { gte: since } };
    }
  }

  // 対象件数（上限1000）
  const total = await prisma.video.count({ where });
  const limitedTotal = Math.min(total, MAX_TOTAL);

  // 計算のためまとめて取得（最新順で最大1000件）
  const pool = await prisma.video.findMany({
    where,
    orderBy: [{ publishedAt: "desc" as const }],
    take: limitedTotal,
    select: {
      id: true,
      platform: true,
      platformVideoId: true,
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

  // スコア計算 → 降順ソート
  const ranked = pool
    .map((v) => ({
      ...v,
      _score: trendingScore(v.views, v.likes, new Date(v.publishedAt)),
    }))
    .sort((a, b) => b._score - a._score);

  // ページング
  const totalPages = Math.max(1, Math.ceil(limitedTotal / PAGE_SIZE));
  const start = (safePage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const items = ranked.slice(start, end);

  const current: SearchParams = {
    q,
    range,
    p: String(safePage),
  };

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">🔥 急上昇</h1>

      {/* フィルタ */}
      <form className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          name="q"
          defaultValue={q}
          placeholder="キーワード（タイトル・説明・チャンネル名）"
          className="w-full rounded border px-3 py-2"
        />
        <select name="range" defaultValue={range} className="rounded border px-3 py-2">
          <option value="1d">今日（24時間）</option>
          <option value="7d">直近7日</option>
          <option value="30d">直近30日</option>
          <option value="365d">直近1年</option>
          <option value="all">全期間</option>
        </select>
        <button className="rounded bg-black px-4 py-2 text-white">更新</button>
      </form>

      {/* ヒット情報 */}
      <div className="mb-4 text-sm text-gray-600">
        対象 {limitedTotal.toLocaleString()} 件（{safePage}/{totalPages}）
      </div>

      {/* 4カラムグリッド（トップと同じ見た目） */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((v) => (
          <a
            key={v.id}
            href={v.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded border shadow-sm hover:shadow-md"
          >
            <div className="relative aspect-video">
              <img
                src={v.thumbnailUrl ?? "/placeholder.png"}
                alt={v.title}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="p-2">
              <h3 className="line-clamp-2 text-sm font-medium">{v.title}</h3>
              <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                <div>📺 {v.channelTitle}</div>
                <div>⏱ {v.publishedAt ? new Date(v.publishedAt).toLocaleString() : ""}</div>
                <div>
                  👁 {v.views?.toLocaleString?.() ?? v.views}　❤️{" "}
                  {v.likes?.toLocaleString?.() ?? v.likes}
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* ページネーション */}
      <div className="mt-6 flex items-center justify-between">
        <Link
          href={makeQuery(current, { p: String(Math.max(1, safePage - 1)) })}
          className={`rounded border px-3 py-2 ${
            safePage <= 1 ? "pointer-events-none opacity-40" : ""
          }`}
        >
          ← 前の50件
        </Link>

        <div className="text-sm">
          表示 {items.length} / {limitedTotal} 件（{safePage}/{totalPages}）
        </div>

        <Link
          href={makeQuery(current, { p: String(Math.min(totalPages, safePage + 1)) })}
          className={`rounded border px-3 py-2 ${
            safePage >= totalPages ? "pointer-events-none opacity-40" : ""
          }`}
        >
          次の50件 →
        </Link>
      </div>
    </main>
  );
}
