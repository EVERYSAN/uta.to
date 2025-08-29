import { PrismaClient, Prisma } from "@prisma/client";
import ResultsGrid from "@/components/ResultsGrid";

const prisma = new PrismaClient();
const PAGE_SIZE = 50;

export default async function Page({
  searchParams,
}: {
  searchParams: { q?: string; sort?: string };
}) {
  const q = (searchParams.q ?? "").trim();
  const sort = (searchParams.sort ?? "newest").toLowerCase() as
    | "newest"
    | "oldest";

  // ---- 検索条件 / 並び順 ----
  const where: Prisma.VideoWhereInput | undefined = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      }
    : undefined;

  const orderBy: Prisma.VideoOrderByWithRelationInput =
    sort === "oldest" ? { publishedAt: "asc" } : { publishedAt: "desc" };

  // ---- 初期 50 件読み込み（＋次ページ判定用に +1 件）----
  const first = await prisma.video.findMany({
    where,
    orderBy,
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      platform: true,
      platformVideoId: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      durationSec: true,
      publishedAt: true, // Date -> 下で文字列へ
    },
  });

  // Client Component に渡すので Date を文字列化
  const initialItems = first.slice(0, PAGE_SIZE).map((v) => ({
    ...v,
    publishedAt: v.publishedAt.toISOString(),
  }));

  const initialCursor = first.length > PAGE_SIZE ? first[PAGE_SIZE].id : null;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">歌ってみた 検索</h1>

      {/* ---- 検索フォーム & 並び替え & 収集ボタン ---- */}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <form action="/" method="get" className="flex gap-2 grow">
          <input
            name="q"
            defaultValue={q}
            placeholder="キーワード"
            className="input input-bordered w-full"
          />
          <select
            name="sort"
            defaultValue={sort}
            className="select select-bordered"
          >
            <option value="newest">新着順</option>
            <option value="oldest">古い順</option>
          </select>
          <button type="submit" className="btn btn-primary">
            検索
          </button>
        </form>

        {/* 収集トリガー（GET でOK。CRON とは別口の手動実行） */}
        <a href="/api/ingest/youtube" className="btn">
          今すぐ収集
        </a>
      </div>

      {/* ---- 一覧 ---- */}
      <ResultsGrid
        initialItems={initialItems}
        initialCursor={initialCursor}
        q={q}
        sort={sort}
        pageSize={50}
        maxTotal={1000}
      />
    </main>
  );
}
