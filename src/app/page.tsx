// src/app/page.tsx
import Link from "next/link";
import { PrismaClient, Prisma } from "@prisma/client";

// 型定義（UI側で使う軽量データ）
type VideoItem = {
  id: string;
  platform: string;
  platformVideoId: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  durationSec: number | null;
  publishedAt: string; // 表示用は string に統一
};

const prisma = new PrismaClient();

const PAGE_SIZE = 50;
const MAX_TOTAL = 1000;

function formatDuration(sec?: number | null) {
  if (!sec && sec !== 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatJst(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const M = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${M}/${day} ${hh}:${mm}`;
}

function VideoCard({ v }: { v: VideoItem }) {
  return (
    <article className="rounded-lg border bg-white shadow-sm overflow-hidden">
      <a href={v.url} target="_blank" rel="noreferrer" className="block">
        <div className="relative aspect-video">
          <img
            src={v.thumbnailUrl ?? "/placeholder.png"}
            alt={v.title}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      </a>

      <div className="p-3 text-sm">
        <div className="text-xs text-gray-500">
          {formatJst(v.publishedAt)} ・ {formatDuration(v.durationSec)}
        </div>
        <a
          href={v.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block font-medium leading-snug line-clamp-2 hover:underline"
          title={v.title}
        >
          {v.title}
        </a>
      </div>
    </article>
  );
}

function ResultsGrid({ items }: { items: VideoItem[] }) {
  return (
    <div className="grid gap-6 mt-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((v) => (
        <VideoCard key={v.id} v={v} />
      ))}
    </div>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: { q?: string; sort?: string; p?: string };
}) {
  const q = searchParams.q ?? "";
  const sort = searchParams.sort ?? "new";
  const safePage = Math.max(1, parseInt(searchParams.p ?? "1", 10) || 1);

  // where（大小文字無視で title/description を部分一致）
  const where: Prisma.VideoWhereInput =
    q.length > 0
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};

  // orderBy（Prisma の SortOrder を使用）
  const orderBy: Prisma.VideoOrderByWithRelationInput =
    sort === "old" ? { publishedAt: "asc" } : { publishedAt: "desc" };

  // 総件数（最大1000件でクリップ）
  const total = Math.min(MAX_TOTAL, await prisma.video.count({ where }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // データ取得（Date → string へ変換）
  const rows = await prisma.video.findMany({
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
      publishedAt: true, // DBは Date
    },
  });

  const items: VideoItem[] = rows.map((r) => ({
    ...r,
    publishedAt: r.publishedAt.toISOString(), // UIで扱いやすい形に
  }));

  // ページング用クエリ組み立て
  const makeQuery = (params: Record<string, string>) => {
    const sp = new URLSearchParams({ q, sort, ...params });
    return `/?${sp.toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-6 py-8">
      <h1 className="text-2xl font-bold mb-4">歌ってみた 検索</h1>

      {/* 検索フォーム */}
      <form action="/" method="get" className="flex gap-2 mb-4">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="キーワード"
          className="flex-1 border rounded px-3 py-2"
        />
        <select name="sort" defaultValue={sort} className="border rounded px-2 py-2">
          <option value="new">新着順</option>
          <option value="old">古い順</option>
        </select>
        <button type="submit" className="px-4 py-2 bg-black text-white rounded">
          検索
        </button>
      </form>

      {/* ヘッダ行 */}
      <div className="mb-2 text-sm text-gray-600">
        ヒット {total} 件（表示 {items.length} 件） | ページ {safePage}/{totalPages}
      </div>

      {/* 一覧（4カラムまで自動で折り返し） */}
      // 例: 一覧描画部分
      <div className="grid gap-6 mt-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map(v => <VideoCard key={v.id} v={v} />)}
      </div>
      // 例: VideoCard のサムネイル
      <div className="relative aspect-video">
        <img
          src={v.thumbnailUrl ?? "/placeholder.png"}
          alt={v.title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      </div>


      {/* ページネーション */}
      <div className="flex items-center justify-between mt-6">
        <Link
          href={makeQuery({ p: String(Math.max(1, safePage - 1)) })}
          className={`px-3 py-2 border rounded ${
            safePage <= 1 ? "pointer-events-none opacity-40" : ""
          }`}
        >
          ← 前の50件
        </Link>

        <div className="text-sm">
          表示 {items.length} / {Math.min(MAX_TOTAL, total)} 件（{safePage}/{totalPages}）
        </div>

        <Link
          href={makeQuery({ p: String(Math.min(totalPages, safePage + 1)) })}
          className={`px-3 py-2 border rounded ${
            safePage >= totalPages ? "pointer-events-none opacity-40" : ""
          }`}
        >
          次の50件 →
        </Link>
      </div>
    </div>
  );
}

