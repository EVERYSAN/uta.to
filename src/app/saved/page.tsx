// FILE: src/app/saved/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type SavedShape = string[] | Record<string, boolean> | Record<string, any>;
type Video = {
  id: string;
  title: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  publishedAt: string | null;
  channelTitle: string | null;
  views: number | null;
  likes: number | null;
};

const nf = new Intl.NumberFormat("ja-JP");
const fmtCount = (n?: number | null) => (typeof n === "number" ? nf.format(n) : "0");

export default function SavedPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [items, setItems] = useState<Video[] | null>(null);

  // ストレージからID復元（配列 or マップ or オブジェクト想定）
  useEffect(() => {
    try {
      const raw = localStorage.getItem("saved:videos") ?? localStorage.getItem("savedVideos");
      if (!raw) return;
      const data: SavedShape = JSON.parse(raw);
      let list: string[] = [];
      if (Array.isArray(data)) {
        list = data.map(String);
      } else if (data && typeof data === "object") {
        list = Object.entries(data)
          .filter(([, v]) => !!v)
          .map(([k]) => String(k));
      }
      setIds(Array.from(new Set(list)));
    } catch {}
  }, []);

  // まとめて取得
  useEffect(() => {
    const run = async () => {
      if (!ids || ids.length === 0) {
        setItems([]);
        return;
      }
      const qs = new URLSearchParams({ ids: ids.join(",") });
      const res = await fetch(`/api/videos/by-ids?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; items: Video[] };
      setItems(json?.items ?? []);
    };
    run();
  }, [ids]);

  const onRemove = (id: string) => {
    try {
      const raw = localStorage.getItem("saved:videos") ?? localStorage.getItem("savedVideos");
      if (!raw) return;
      const data: SavedShape = JSON.parse(raw);
      if (Array.isArray(data)) {
        const next = data.filter((x) => String(x) !== id);
        localStorage.setItem("saved:videos", JSON.stringify(next));
      } else if (data && typeof data === "object") {
        const next = { ...data };
        delete (next as Record<string, any>)[id];
        localStorage.setItem("saved:videos", JSON.stringify(next));
      }
      setIds((prev) => prev.filter((x) => x !== id));
      setItems((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    } catch {}
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold">保存した動画</h1>
        <Link href="/trending" prefetch={false} className="text-sm text-zinc-300 hover:underline">
          ← 急上昇へ
        </Link>
      </div>

      {items === null && <div className="text-sm text-zinc-400">読み込み中…</div>}

      {items && items.length === 0 && (
        <div className="text-sm text-zinc-400">
          まだ保存した動画はありません。
          <br />
          急上昇ページで動画詳細を開き、保存してからここで確認できます。
        </div>
      )}

      {items && items.length > 0 && (
        <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((v) => (
            <div key={v.id} className="group rounded-2xl overflow-hidden bg-zinc-900">
              <Link href={`/v/${v.id}`} prefetch={false} className="block">
                <div className="relative aspect-video bg-zinc-800">
                  {v.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.thumbnailUrl}
                      alt={v.title ?? ""}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="p-3 space-y-2">
                  <h3 className="text-sm font-semibold leading-snug line-clamp-2 text-zinc-100">
                    {v.title}
                  </h3>
                  <div className="flex items-center gap-3 text-[12px] text-zinc-400">
                    <span>👁 {fmtCount(v.views)}</span>
                    <span>❤️ {fmtCount(v.likes)}</span>
                    {v.channelTitle && (
                      <span className="ml-auto truncate max-w-[50%] text-zinc-300">
                        🎤 {v.channelTitle}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
              <div className="p-3 border-t border-zinc-800">
                <button
                  onClick={() => onRemove(v.id)}
                  className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                >
                  保存から外す
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
