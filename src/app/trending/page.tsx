"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// 動的レンダー（プリレンダーの絡みを回避）
export const dynamic = "force-dynamic";

// ===== ユーティリティ =====
const nf = new Intl.NumberFormat("ja-JP");
const fmtCount = (n?: number | null) => (typeof n === "number" ? nf.format(n) : "0");
const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
};
const secsToLabel = (s?: number | null) => {
  if (!s && s !== 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

// ===== 型 =====
type Video = {
  id: string;
  platform: "youtube";
  platformVideoId: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  durationSec?: number | null;
  publishedAt?: string;
  channelTitle?: string;
  views?: number | null;
  likes?: number | null;
  trendingRank?: number | null;
  trendingScore?: number | null;
  deltaViews?: number | null;
  deltaLikes?: number | null;
};
type ApiList = { ok: boolean; items: Video[]; page?: number; take?: number; total?: number };

// ===== バッジ =====
function TrendingBadge({ rank, range }: { rank?: number | null; range: "1d" | "7d" | "30d" }) {
  const label = rank ? `#${rank}` : "急上昇";
  const rangeText = range === "1d" ? "24時間" : range === "7d" ? "7日間" : "30日間";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-violet-600/20 text-violet-300 px-2 py-0.5 text-[11px]">
      <span>⬆</span><span className="font-medium">{label}</span>
      <span className="opacity-70">/ {rangeText}</span>
      <span className="ml-1 cursor-help group relative select-none">ⓘ
        <span className="pointer-events-none hidden group-hover:block absolute left-1/2 -translate-x-1/2 top-6 w-72 rounded-md bg-zinc-900 p-3 text-xs text-zinc-200 shadow-xl z-10">
          急上昇スコアは直近期間の「再生増加」「高評価増加」「公開からの新しさ」を総合評価しています（例：24h=昨日比）。表示は独自集計です。
        </span>
      </span>
    </div>
  );
}

// ===== 動画カード =====
function VideoCard({ v, range }: { v: Video; range: "1d" | "7d" | "30d" }) {
  return (
    <a href={v.url} target="_blank" rel="noopener noreferrer"
       className="group block rounded-2xl overflow-hidden bg-zinc-900 hover:bg-zinc-800 transition-colors">
      <div className="relative aspect-video bg-zinc-800">
        {v.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.thumbnailUrl} alt={v.title} loading="lazy"
               className="absolute inset-0 h-full w-full object-cover" />
        )}
        {typeof v.durationSec === "number" && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 text-white text-[11px] px-1.5 py-0.5">
            {secsToLabel(v.durationSec)}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <TrendingBadge rank={v.trendingRank ?? null} range={range} />
          <div className="text-[11px] text-zinc-400">{fmtDate(v.publishedAt)}</div>
        </div>

        <h3 className="text-sm font-semibold leading-snug line-clamp-2 text-zinc-100">{v.title}</h3>

        <div className="flex items-center gap-3 text-[12px] text-zinc-400">
          <span className="inline-flex items-center gap-1">👁 {fmtCount(v.views)}</span>
          <span className="inline-flex items-center gap-1">❤️ {fmtCount(v.likes)}</span>
          {v.channelTitle && (
            <span className="ml-auto truncate max-w-[50%] text-zinc-300">🎤 {v.channelTitle}</span>
          )}
        </div>
      </div>
    </a>
  );
}

// ===== フィルタバー =====
function FilterBar({
  range, minSec, maxSec, onChange
}: {
  range: "1d" | "7d" | "30d";
  minSec: number; maxSec: number;
  onChange: (next: Partial<{ range: "1d" | "7d" | "30d"; minSec: number; maxSec: number; }>) => void;
}) {
  const isLenFilter = minSec === 61 && maxSec === 300;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[
        { k: "1d", label: "24h" },
        { k: "7d", label: "7日" },
        { k: "30d", label: "30日" },
      ].map(({ k, label }) => (
        <button key={k} onClick={() => onChange({ range: k as any })}
          className={`px-3 py-1.5 rounded-full text-sm ${
            range === k ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          }`}>
          {label}
        </button>
      ))}

      <label className="ml-2 inline-flex items-center gap-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-full px-3 py-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={isLenFilter}
          onChange={(e) =>
            onChange(e.target.checked ? { minSec: 61, maxSec: 300 } : { minSec: 0, maxSec: 60 * 60 })
          }
        />
        <span>長さ 61秒〜5分</span>
      </label>

      <span className="text-xs text-zinc-500 ml-auto">並び: 急上昇</span>
    </div>
  );
}

// ===== 中身（useSearchParams を使う）=====
function TrendingPageInner() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [range, setRange] = useState<"1d" | "7d" | "30d">((search.get("range") as any) || "1d");
  const [minSec, setMinSec] = useState<number>(parseInt(search.get("minSec") || "61", 10));
  const [maxSec, setMaxSec] = useState<number>(parseInt(search.get("maxSec") || "300", 10));

  const [items, setItems] = useState<Video[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const syncQuery = (next?: Partial<{ range: "1d" | "7d" | "30d"; minSec: number; maxSec: number }>) => {
    const r = next?.range ?? range;
    const mi = next?.minSec ?? minSec;
    const ma = next?.maxSec ?? maxSec;
    const qs = new URLSearchParams(search.toString());
    qs.set("sort", "trending");
    qs.set("range", r);
    qs.set("minSec", String(mi));
    qs.set("maxSec", String(ma));
    router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
  };

  useEffect(() => {
    setItems([]); setPage(1); setHasMore(true);
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, minSec, maxSec]);

  const queryString = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("sort", "trending");
    qs.set("range", range);
    qs.set("minSec", String(minSec));
    qs.set("maxSec", String(maxSec));
    qs.set("page", String(page));
    qs.set("take", "24");
    return qs.toString();
  }, [range, minSec, maxSec, page]);

  async function fetchPage(p: number, replace = false) {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("sort", "trending");
      qs.set("range", range);
      qs.set("minSec", String(minSec));
      qs.set("maxSec", String(maxSec));
      qs.set("page", String(p));
      qs.set("take", "24");
      const res = await fetch(`/api/videos?${qs.toString()}`, { cache: "no-store" });
      const json: ApiList = await res.json();
      const rows = json?.items ?? [];
      setItems((prev) => (replace ? rows : [...prev, ...rows]));
      if (rows.length < 24) setHasMore(false);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const ob = new IntersectionObserver(
      (ents) => {
        ents.forEach((ent) => {
          if (ent.isIntersecting && !loading && hasMore) {
            const next = page + 1;
            setPage(next);
            fetchPage(next);
          }
        });
      },
      { rootMargin: "600px 0px" }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [page, loading, hasMore]);

  useEffect(() => {
    const r = (search.get("range") as "1d" | "7d" | "30d") || "1d";
    const mi = parseInt(search.get("minSec") || "61", 10);
    const ma = parseInt(search.get("maxSec") || "300", 10);
    setRange(r);
    setMinSec(isNaN(mi) ? 61 : mi);
    setMaxSec(isNaN(ma) ? 300 : ma);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 初回のみ

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">急上昇</h1>
      </div>

      <FilterBar
        range={range}
        minSec={minSec}
        maxSec={maxSec}
        onChange={(next) => {
          if (next.range) setRange(next.range);
          if (typeof next.minSec === "number") setMinSec(next.minSec);
          if (typeof next.maxSec === "number") setMaxSec(next.maxSec);
          syncQuery(next);
        }}
      />

      <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {items.map((v) => (<VideoCard key={v.id} v={v} range={range} />))}
      </section>

      <div ref={sentinelRef} />
      {loading && <div className="text-center text-sm text-zinc-400 py-4">読み込み中…</div>}
      {!hasMore && !loading && items.length > 0 && (
        <div className="text-center text-sm text-zinc-500 py-6">以上です</div>
      )}
      {!loading && items.length === 0 && (
        <div className="text-center text-sm text-zinc-500 py-10">該当する動画がありません</div>
      )}
    </main>
  );
}

// ===== Suspense でラップ =====
export default function TrendingPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-7xl px-4 py-6">
          <div className="text-center text-sm text-zinc-400 py-4">読み込み中…</div>
        </main>
      }
    >
      <TrendingPageInner />
    </Suspense>
  );
}
