// src/app/page.tsx
import Link from "next/link";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 1ページあたり
const PAGE_SIZE = 50;
// 最大取得件数（合計）
const MAX_TOTAL = 1000;

type SearchParams = {
  q?: string;
  sort?: "new" | "old";
  p?: string; // 1-origin
};

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const q = (searchParams.q ?? "").trim();
  const sort = (searchParams.sort === "old" ? "old" : "new") as
    | "new"
    | "old";
  const page = Math.max(1, Number(searchParams.p ?? 1));

  // where 条件（Prisma 型に素直に合わせる）
  let where: Prisma.VideoWhereInput | undefined;
  if (q) {
    // タイトル OR 説明 の部分一致（大文字小文字無視）
    where = {
      OR: [
        {
          title: {
            contains: q,
            mode: Prisma.QueryMode.insensitive,
          },
        },
        {
          description: {
            contains: q,
            mode: Prisma.QueryMode.insensitive,
          },
        },
      ],
    };
  }

  // 並び順
  const orderBy: Prisma.VideoOrderByWithRelationInput =
    sort === "old"
      ? { publishedAt: "asc" }
      : { publishedAt: "desc" };

  // 件数カウント（上限 1000 で丸め）
  const totalRaw = await prisma.video.count({ where });
  const total = Math.min(MAX_TOTAL, totalRaw);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // page が上限を越えたら丸める
  const safePage = Math.min(page, totalPages);
  const skip = (safePage - 1) * PAGE_SIZE;

  // 50件ずつ取得（選択項目はUIで使うものだけ）
  const rows = await prisma.video.findMany({
    where,
    orderBy,
    take: PAGE_SIZE,
    skip,
    select: {
      id: true,
      platform: true,
      platformVideoId: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      durationSec: true,
      publishedAt: true,
    },
  });

  const items = rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    platformVideoId: r.platformVideoId,
    title: r.title,
    url: r.url,
    thumbnailUrl: r.thumbnailUrl ?? "",
    durationSec: r.durationSec ?? 0,
    publishedAt: r.publishedAt.toISOString(), // ← 型ずれを回避（string化）
  }));

  // 検索フォームの値を維持するためのヘルパ
  const makeQuery = (next: Partial<SearchParams>) => {
    const params = new URLSearchParams();
    if (next.q ?? q) params.set("q", (next.q ?? q) as string);
    if (next.sort ?? sort) params.set("sort", (next.sort ?? sort) as string);
    params.set("p", String(next.p ?? safePage));
    return `/?${params.toString()}`;
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      {/* タイトル */}
      <h1 className="text-2xl font-bold mb-4">歌ってみた 検索</h1>

      {/* 検索フォーム（前のフォーマット風） */}
      <form action="/" method="get" className="flex gap-2 mb-3">
        <input
          name="q"
          defaultValue={q}
          placeholder="キーワード"
          className="w-full border px-3 py-2 rounded"
        />
        <select
          name="sort"
          defaultValue={sort}
          className="border px-2 py-2 rounded"
        >
          <option value="new">新着順</option>
          <option value="old">古い順</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 bg-black text-white rounded"
        >
          検索
        </button>
      </form>

      {/* 収集ボタン（今すぐ収集） */}
      <div className="mb-2">
        <a
          href="/api/ingest/youtube"
          className="inline-block px-4 py-2 border rounded hover:bg-gray-50"
        >
          今すぐ収集
        </a>
      </div>

      {/* 件数表示（前フォーマット風） */}
      <div className="text-sm mb-3">
        ヒット {total} 件（表示 {items.length} 件） &nbsp;|&nbsp; ページ{" "}
        {safePage} / {totalPages}
      </div>

      {/* 一覧（前のカードレイアウト風。必要に応じて整えてね） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {items.map((v) => (
          <a
            key={v.id}
            href={v.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded border overflow-hidden hover:shadow"
          >
            {/* サムネイル */}
            <div className="aspect-video bg-gray-100">
              {v.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={v.thumbnailUrl}
                  alt={v.title}
                  className="w-full h-full object-cover"
                />
              ) : null}
            </div>

            {/* テキスト情報 */}
            <div className="p-3">
              <div className="text-xs text-gray-500 mb-1">
                {formatDateJP(v.publishedAt)} ・ {formatDuration(v.durationSec)}
              </div>
              <div className="font-medium line-clamp-2">{v.title}</div>
            </div>
          </a>
        ))}
      </div>

      {/* ページネーション */}
      <div className="flex items-center justify-between mt-6">
        <Link
          href={makeQuery({ p: Math.max(1, safePage - 1) })}
          className={`px-3 py-2 border rounded ${
            safePage <= 1 ? "pointer-events-none opacity-40" : ""
          }`}
        >
          ← 前の50件
        </Link>

        <div className="text-sm">
          表示 {items.length} / {Math.min(MAX_TOTAL, total)} 件（{safePage}/
          {totalPages}）
        </div>

        <Link
          href={makeQuery({ p: Math.min(totalPages, safePage + 1) })}
          className={`px-3 py-2 border rounded ${
            safePage >= totalPages ? "pointer-events-none opacity-40" : ""
          }`}
        >
          次の50件 →
        </Link>
      </div>
    </main>
  );
}

function formatDateJP(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

function formatDuration(sec: number) {
  if (!sec || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}
