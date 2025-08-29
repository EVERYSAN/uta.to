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

  // 初期50件だけ SSR で取得
  const first = await prisma.video.findMany({
    where,
    orderBy,
    take: PAGE_SIZE + 1, // 次があるか判断
    select: {
      id: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      platform: true,
      platformVideoId: true,
      publishedAt: true,
      durationSec: true,
    },
  });

  const initialItems = first.slice(0, PAGE_SIZE);
  const initialCursor = first.length > PAGE_SIZE ? first[PAGE_SIZE].id : null;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* ← 検索フォームやソート UI はそのまま */}
      {/* ここから一覧 */}
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
