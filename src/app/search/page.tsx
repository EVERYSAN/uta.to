// Server → Suspense → Client 構成
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="py-10 text-sm text-neutral-500">検索中...</div>}>
      <SearchContent />
    </Suspense>
  );
}

// ↓ここから “元の実装” を移植（Client）
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Item = {
  id: string;
  platform: string;
  platformVideoId: string;
  title: string;
  channelTitle: string;
  url: string;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  publishedAt?: string | Date | null;
  views?: number;
  likes?: number;
  supportPoints?: number;
};

function SearchContent() {
  // URLクエリ ←→ 状態（初回は window.location から読む）
  const [q, setQ] = useState("");
  const [range, setRange] = useState<"1d" | "7d" | "30d">("7d"); // 既定を7dに
  const [shorts, setShorts] = useState<"all" | "exclude" | "only">("all");
  const [sort, setSort] = useState<"hot" | "new" | "support">("hot");

  useEffect(() => {
    const s = new URLSearchParams(window.location.search);
    setQ(s.get("q") ?? "");
    setRange(((s.get("range") as any) ?? "7d") as "1d" | "7d" | "30d");
    setShorts(((s.get("shorts") as any) ?? "all") as "all" | "exclude" | "only");
    setSort(((s.get("sort") as any) ?? "hot") as "hot" | "new" | "support");
  }, []);

  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    p.set("range", range);
    p.set("shorts", shorts);
    p.set("sort", sort);
    p.set("page", String(page));
    p.set("take", "24");
    return p.toString();
  }, [q, range, shorts, sort, page]);

  const pushUrl = useCallback(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    p.set("range", range);
    p.set("shorts", shorts);
    p.set("sort", sort);
    const url = `/search?${p.toString()}`;
    window.history.replaceState(null, "", url);
  }, [q, range, shorts, sort]);

  const fetchPage = useCallback(
    async (reset = false) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const res = await fetch(`/api/search?${queryString}`, {
        cache: "no-store",
        signal: ac.signal,
      });
      const json = await res.json();
      if (!json?.ok) return;

      setItems((prev) => (reset ? json.items : [...prev, ...json.items]));
      setHasMore(json.items.length >= 24);
    },
    [queryString]
  );

  useEffect(() => {
    setPage(1);
    fetchPage(true);
    pushUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, range, shorts, sort]);

  useEffect(() => {
    if (page === 1) return;
    fetchPage(false);
  }, [page, fetchPage]);

  return (
    <div className="min-h-screen pb-[68px]">
      {/* PC：上部検索バー */}
      <div className="sticky top-0 z-20 hidden md:block bg-black/40 backdrop-blur border-b border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-3 flex gap-3 items-center">
          <SearchBox value={q} onChange={setQ} onSubmit={() => setPage(1)} />
          <Toolbar
            range={range}
            setRange={setRange}
            shorts={shorts}
            setShorts={setShorts}
            sort={sort}
            setSort={setSort}
          />
        </div>
      </div>

      {/* SP：上部に検索バー＋簡易ツールバー */}
      <div className="md:hidden px-4 pt-3 pb-2 sticky top-0 z-20 bg-black">
        <SearchBox value={q} onChange={setQ} onSubmit={() => setPage(1)} />
        <div className="mt-2">
          <Toolbar
            compact
            range={range}
            setRange={setRange}
            shorts={shorts}
            setShorts={setShorts}
            sort={sort}
            setSort={setSort}
          />
        </div>
      </div>

      {/* 結果グリッド */}
      <div className="mx-auto max-w-6xl px-4 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((v) => (
          <a key={v.id} href={v.url} target="_blank" rel="noreferrer" className="group">
            <div className="aspect-video overflow-hidden rounded-lg bg-neutral-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={v.thumbnailUrl ?? ""}
                alt=""
                className="w-full h-full object-cover group-hover:opacity-90"
              />
            </div>
            <div className="mt-2 text-sm leading-tight line-clamp-2">{v.title}</div>
            <div className="text-xs text-neutral-400">{v.channelTitle}</div>
            {typeof v.supportPoints === "number" && (
              <div className="text-xs mt-1 text-pink-400">応援 {v.supportPoints}</div>
            )}
          </a>
        ))}
      </div>

      {/* もっと見る */}
      {hasMore && (
        <div className="py-6 text-center">
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20"
          >
            さらに読み込み
          </button>
        </div>
      )}

      {/* SPフッタータブ（ホーム/検索） */}
      <MobileTabBar />
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex-1 flex gap-2"
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="キーワードを入力"
        className="w-full px-3 py-2 rounded-lg bg-white/10 outline-none"
      />
      <button className="px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30">検索</button>
    </form>
  );
}

function Toolbar({
  range,
  setRange,
  shorts,
  setShorts,
  sort,
  setSort,
  compact,
}: {
  range: "1d" | "7d" | "30d";
  setRange: (v: "1d" | "7d" | "30d") => void;
  shorts: "all" | "exclude" | "only";
  setShorts: (v: "all" | "exclude" | "only") => void;
  sort: "hot" | "new" | "support";
  setSort: (v: "hot" | "new" | "support") => void;
  compact?: boolean;
}) {
  const btn = "px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm";
  const wrap = compact ? "flex gap-2 flex-wrap" : "flex gap-2 items-center";
  return (
    <div className={wrap}>
      <select value={range} onChange={(e) => setRange(e.target.value as any)} className={btn}>
        <option value="1d">24h</option>
        <option value="7d">7日</option>
        <option value="30d">30日</option>
      </select>
      <select value={shorts} onChange={(e) => setShorts(e.target.value as any)} className={btn}>
        <option value="all">すべて</option>
        <option value="exclude">ショート除外</option>
        <option value="only">ショートのみ</option>
      </select>
      <select value={sort} onChange={(e) => setSort(e.target.value as any)} className={btn}>
        <option value="hot">人気</option>
        <option value="new">新着</option>
        <option value="support">応援</option>
      </select>
    </div>
  );
}

function MobileTabBar() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-black/80 backdrop-blur supports-[height:100svh]:pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-3xl mx-auto px-6 py-2 grid grid-cols-2 gap-3">
        <Link href="/" className="flex flex-col items-center py-2">
          <span className="text-base">🏠</span>
          <span className="text-xs mt-0.5">ホーム</span>
        </Link>
        <Link href="/search" className="flex flex-col items-center py-2">
          <span className="text-base">🔎</span>
          <span className="text-xs mt-0.5">検索</span>
        </Link>
      </div>
    </nav>
  );
}
