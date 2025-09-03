// src/app/trending/page.tsx
import React from "react";

// ボタン等で選んだ値をURLSearchParamsにそのまま流すだけでOK
async function fetchVideos(params: { range: "24h" | "7d" | "30d"; shorts?: "any"|"only"|"exclude"|"long"; sort?: "trending"|"support"|"latest"|"popular"; page?: number; take?: number; }) {
  const qp = new URLSearchParams();
  qp.set("range", params.range);
  if (params.shorts) qp.set("shorts", params.shorts);
  if (params.sort) qp.set("sort", params.sort);
  qp.set("page", String(params.page ?? 1));
  qp.set("take", String(params.take ?? 24));

  const res = await fetch(`/api/videos?${qp.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load");
  return res.json() as Promise<{ ok: boolean; meta: any; items: any[] }>;
}

export default async function Page({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  // URL のクエリをそのまま API へ
  const range = (searchParams.range as "24h" | "7d" | "30d") ?? "24h";
  const shorts = (searchParams.shorts as any) ?? "any"; // any|only|exclude|long
  const sort = (searchParams.sort as any) ?? "trending";
  const page = Number(searchParams.page ?? 1);

  const data = await fetchVideos({ range, shorts, sort, page, take: 24 });

  // ここから先は従来の UI そのまま（カード表示など）
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6">
      {/* フィルタバー（従来のデザインのままでOK。リンクは ?range=24h などに） */}
      {/* ... */}

      {/* 一覧 */}
      {data.items.length === 0 ? (
        <div className="text-center text-sm text-zinc-400 mt-16">該当する動画がありません</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((v) => (
            <article key={v.id} className="rounded-xl bg-zinc-900/40 p-3">
              <img src={v.thumbnailUrl} alt="" className="w-full aspect-video rounded-lg object-cover" />
              <div className="mt-2 text-sm">
                <div className="font-medium line-clamp-2">{v.title}</div>
                <div className="text-zinc-400 text-xs mt-1">
                  {v.channelTitle} ・ {v.durationSec ?? "-"}s ・ {new Date(v.publishedAt).toLocaleString()}
                </div>
                <div className="text-zinc-400 text-xs mt-1">
                  👀 {v.views ?? 0}　❤️ {v.likes ?? 0}　🔥pt {v.support ?? 0}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
