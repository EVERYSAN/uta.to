import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // 念のためNodeランタイム固定

export default async function Home() {
  const videos = await prisma.video.findMany({
    orderBy: { publishedAt: "desc" },
    take: 30,
  });

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-bold mb-4">最新の「歌ってみた」</h1>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {videos.map((v) => (
          <li key={v.id} className="border rounded-lg p-3">
            {v.thumbnailUrl && (
              <a href={v.url} target="_blank" rel="noreferrer">
                <img src={v.thumbnailUrl} alt={v.title} className="w-full rounded mb-2" />
              </a>
            )}
            <a className="font-semibold hover:underline" href={v.url} target="_blank" rel="noreferrer">
              {v.title}
            </a>
            <div className="text-sm text-gray-500">
              {new Date(v.publishedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
