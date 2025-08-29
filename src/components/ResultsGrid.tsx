"use client";

import { useEffect, useRef, useState } from "react";

type VideoItem = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  platform: string;
  platformVideoId: string;
  publishedAt: string; // ISO
  durationSec: number | null;
};

type Props = {
  initialItems: VideoItem[];
  initialCursor: string | null;
  q: string;
  sort: "newest" | "oldest";
  // 50件ずつ、最大1000件
  pageSize?: number;
  maxTotal?: number;
};

export default function ResultsGrid({
  initialItems,
  initialCursor,
  q,
  sort,
  pageSize = 50,
  maxTotal = 1000,
}: Props) {
  const [items, setItems] = useState<VideoItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState<boolean>(!!initialCursor);
  const [error, setError] = useState<string | null>(null);

  const loadedCount = items.length;
  const reachedLimit = loadedCount >= maxTotal;

  async function loadMore() {
    if (loading || !hasMore || reachedLimit) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      params.set("sort", sort);
      if (cursor) params.set("cursor", cursor);
      // API側は常に50固定だが一応指定
      params.set("limit", String(pageSize));

      const res = await fetch(`/api/videos?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: {
        items: VideoItem[];
        nextCursor: string | null;
        hasMore: boolean;
      } = await res.json();

      // 最大1000件を超えないように切り詰め
      const remain = maxTotal - items.length;
      const nextChunk =
        remain >= json.items.length ? json.items : json.items.slice(0, remain);

      setItems((prev) => [...prev, ...nextChunk]);
      setCursor(json.nextCursor);
      setHasMore(json.hasMore && items.length + nextChunk.length < maxTotal);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // 画面最下部付近で自動ロード（IntersectionObserver）
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinelRef.current) return;
    if (reachedLimit || !hasMore) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "1200px 0px" } // 余裕を持って先読み
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, hasMore, reachedLimit]);

  return (
    <>
      <p className="text-sm text-neutral-500 mb-3">
        表示 {loadedCount} / {maxTotal} 件
      </p>

      {/* グリッド */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((v) => (
          <article key={v.id} className="rounded-xl overflow-hidden border">
            <a href={v.url} target="_blank" rel="noreferrer">
              <div className="aspect-video bg-neutral-100">
                {/* サムネイル */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    v.thumbnailUrl ??
                    `https://i.ytimg.com/vi/${v.platformVideoId}/hqdefault.jpg`
                  }
                  alt={v.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            </a>
            <div className="p-3">
              <div className="text-xs text-neutral-500">
                {new Date(v.publishedAt).toLocaleString()}
                {v.durationSec != null && (
                  <> ・ {Math.floor(v.durationSec / 60)}:{(v.durationSec % 60).toString().padStart(2, "0")}</>
                )}
              </div>
              <div className="mt-1 font-medium line-clamp-2">{v.title}</div>
            </div>
          </article>
        ))}
      </div>

      {/* ステータス表示 */}
      {error && <p className="mt-4 text-red-600 text-sm">Error: {error}</p>}

      {/* もっと見るボタン */}
      <div className="mt-6 flex items-center justify-center">
        {!reachedLimit && hasMore ? (
          <button
            className="px-4 py-2 rounded-md bg-black text-white disabled:opacity-50"
            disabled={loading}
            onClick={loadMore}
          >
            {loading ? "読み込み中…" : `さらに読み込む（+${pageSize}件）`}
          </button>
        ) : (
          <p className="text-neutral-500 text-sm">
            {reachedLimit ? "最大 1000 件まで読み込み済み" : "これ以上はありません"}
          </p>
        )}
      </div>

      {/* 無限スクロール用の番兵 */}
      <div ref={sentinelRef} className="h-8" />
    </>
  );
}
