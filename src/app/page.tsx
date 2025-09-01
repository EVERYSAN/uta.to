import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

const PAGE_SIZE = 50;
const MAX_TOTAL = 1000;

type SearchParams = {
  q?: string;
  sort?: "new" | "old" | "views" | "likes";
  range?: "all" | "1d" | "7d" | "30d" | "365d"; // 期間フィルタ
  p?: string; // page
};

// クエリ文字列生成（searchParams を参照しない）
function makeQuery(base: SearchParams, patch: Partial<SearchParams>) {
  const params = new URLSearchParams();
  const q = (patch.q ?? base.q ?? "").toString();
  const sort = (patch.sort ?? base.sort ?? "new").toString();
  const p = (patch.p ?? base.p ?? "1").toString();
  const range = (patch.range ?? base.range ?? "all").toString();

  if (q) params.set("q", q);
  if (sort) params.set("sort", sort);
  if (p) params.set("p", p);
  if (range && range !== "all") params.set("range", range); // "all"は省略

  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}
export default function Home() {
  redirect("/trending");
}

export default async function Page({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const q = (searchParams?.q ?? "").trim();
  const sort = (searchParams?.sort ?? "new") as SearchParams["sort"];
  const range = (searchParams?.range ?? "all") as NonNullable<
    SearchParams["range"]
  >;
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

  // 期間フィルタ（views/likes のときだけ有効）
  if ((sort === "views" || sort === "likes") && range !== "all") {
    const daysMap = { "1d": 1, "7d": 7, "30d": 30, "365d": 365 } as const;
    const days = daysMap[range] ?? 0;
    if (days > 0) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      where = { ...(where ?? {}), publishedAt: { gte: since } };
    }
  }

  // orderBy（Prisma の SortOrder 形式）
  const orderBy =
    sort === "old"
      ? [{ publishedAt: "asc" as const }]
      : sort === "views"
      ? [{ views: "desc" as const }, { publishedAt: "desc" as const }]
      : sort === "likes"
      ? [{ likes: "desc" as const }, { publishedAt: "desc" as const }]
      : [{ publishedAt: "desc" as const }];

  const [total, items] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({
      where,
      orderBy,
      take: PAGE_SIZE,
      skip: (safePage - 1) * PAGE_SIZE,
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
    }),
  ]);

  const limitedTotal = Math.min(total, MAX_TOTAL);
  const totalPages = Math.max(1, Math.ceil(limitedTotal / PAGE_SIZE));

  const current: SearchParams = {
    q,
    sort,
    range,
    p: String(safePage),
  };

  const rangeDisabled = sort === "new" || sort === "old";

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-6">
      {/* 検索フォーム */}
      <form className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          name="q"
          defaultValue={q}
          placeholder="キーワード（タイトル・説明・チャンネル名）"
          className="w-full rounded border px-3 py-2"
        />
        <select
          name="sort"
          defaultValue={sort}
          className="rounded border px-3 py-2"
        >
          <option value="new">新着順</option>
          <option value="old">古い順</option>
          <option value="views">再生数が多い順</option>
          <option value="likes">高評価が多い順</option>
        </select>

        {/* 期間セレクト：views/likes の時だけ有効 */}
        <select
          name="range"
          defaultValue={range}
          disabled={rangeDisabled}
          title={
            rangeDisabled
              ? "新着/古い順では期間フィルタは無効です"
              : "集計期間を選択"
          }
          className={`rounded border px-3 py-2 ${
            rangeDisabled ? "opacity-50" : ""
          }`}
        >
          <option value="all">全期間</option>
          <option value="1d">今日（24時間）</option>
          <option value="7d">直近7日</option>
          <option value="30d">直近30日</option>
          <option value="365d">直近1年</option>
        </select>

        <button className="rounded bg-black px-4 py-2 text-white">検索</button>
      </form>

      {/* ヒット情報 */}
      <div className="mb-4 text-sm text-gray-600">
        ヒット {limitedTotal.toLocaleString()} 件（{safePage}/{totalPages}）
      </div>

      {/* 4カラムのグリッド */}
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
                <div>
                  ⏱ {v.publishedAt ? new Date(v.publishedAt).toLocaleString() : ""}
                </div>
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
          href={makeQuery(current, {
            p: String(Math.min(totalPages, safePage + 1)),
          })}
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

