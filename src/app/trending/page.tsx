// src/app/trending/page.tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/* ========= utils ========= */
const nf = new Intl.NumberFormat("ja-JP");
const fmtCount = (n?: number | null) => (typeof n === "number" ? nf.format(n) : "0");
const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
};
const secsToLabel = (s?: number | null) => {
  if (s == null) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

/* ========= types ========= */
type Video = {
  id: string;
  platform: "youtube";
  platformVideoId: string;
  title: string;
  url: string;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  publishedAt?: string | null;
  channelTitle?: string | null;
  views?: number | null;
  likes?: number | null;
  trendingRank?: number | null;
  trendingScore?: number | null;
  supportPoints?: number | null;
};
type ApiList = { ok: boolean; items: Video[]; page?: number; take?: number; total?: number };

/* ========= localStorage key ========= */
const PREFS_KEY = "video:prefs";

/* ========= badge ========= */
function TrendingBadge({ rank, label }: { rank?: number | null; label: string }) {
  const txt = rank ? `#${rank}` : "急上昇";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-violet-600/20 text-violet-300 px-2 py-0.5 text-[11px]">
      <span>⬆</span>
      <span className="font-medium">{txt}</span>
      <span className="opacity-70">/ {label}</span>
    </div>
  );
}

/* ========= “続きから” ========= */
function ContinueFromHistory() {
  const [h, setH] = useState<{ videoId: string; title?: string; at: number } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("lastVideo");
      if (raw) setH(JSON.parse(raw));
    } catch {}
  }, []);
  if (!h) return null;
  return (
    <Link
      href={`/v/${h.videoId}`}
      className="inline-flex items-center gap-2 rounded-md bg-zinc-900 hover:bg-zinc-800 px-3 py-2 text-sm"
      prefetch={false}
    >
      ▶ 続きから見る{h.title ? `：${h.title}` : ""}
    </Link>
  );
}

/* ========= card ========= */
function VideoCard({ v, label }: { v: Video; label: string }) {
  return (
    <Link
      href={`/v/${v.id}`}
      prefetch={false}
      className="group block rounded-2xl overflow-hidden bg-zinc-900 hover:bg-zinc-800 transition-colors"
    >
      <div className="relative aspect-video bg-zinc-800">
        {v.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.thumbnailUrl}
            alt={v.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {typeof v.durationSec === "number" && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 text-white text-[11px] px-1.5 py-0.5">
            {secsToLabel(v.durationSec)}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <TrendingBadge rank={v.trendingRank ?? null} label={label} />
          <div className="text-[11px] text-zinc-400">{fmtDate(v.publishedAt ?? undefined)}</div>
        </div>

        <h3 className="text-sm font-semibold leading-snug line-clamp-2 text-zinc-100">{v.title}</h3>

        <div className="flex items-center gap-3 text-[12px] text-zinc-400">
          <span className="inline-flex items-center gap-1">👁 {fmtCount(v.views)}</span>
          <span className="inline-flex items-center gap-1">❤️ {fmtCount(v.likes)}</span>
          {typeof v.supportPoints === "number" && (
            <span className="inline-flex items-center gap-1">🔥 応援 {fmtCount(v.supportPoints)}</span>
          )}
          {v.channelTitle && (
            <span className="ml-auto truncate max-w-[50%] text-zinc-300">🎤 {v.channelTitle}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ========= filter bar ========= */
type Range = "1d" | "7d" | "30d";
type ShortsMode = "all" | "exclude";
type SortMode = "trending" | "points" | "newest";

function FilterBar(props: {
  range: Range;
  shorts: ShortsMode;
  sort: SortMode;
  onChange: (next: Partial<{ range: Range; shorts: ShortsMode; sort: SortMode }>) => void;
}) {
  const rangeBtns = [
    { k: "1d", label: "24h" },
    { k: "7d", label: "7日" },
    { k: "30d", label: "30日" },
  ] as const;

  const shortsBtns = [
    { k: "exclude", label: "ショート除外" },
    { k: "all", label: "すべて" },
  ] as const;

  const sortBtns = [
    { k: "trending", label: "急上昇" },
    { k: "points", label: "応援順" },
    { k: "newest", label: "新着順" },
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {rangeBtns.map(({ k, label }) => (
        <button
          key={k}
          onClick={() => props.onChange({ range: k as Range })}
          className={`px-3 py-1.5 rounded-full text-sm ${
            props.range === (k as Range)
              ? "bg-violet-600 text-white"
              : "bg-zinc-800 text-white hover:bg-zinc-700"
          }`}
        >
          {label}
        </button>
      ))}

      <div className="ml-2 inline-flex rounded-full bg-zinc-800 p-1">
        {shortsBtns.map(({ k, label }) => (
          <button
            key={k}
            onClick={() => props.onChange({ shorts: k as ShortsMode })}
            className={`px-3 py-1.5 rounded-full text-sm ${
              props.shorts === (k as ShortsMode) ? "bg-violet-600 text-white" : "text-white hover:bg-zinc-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ml-2 inline-flex rounded-full bg-zinc-800 p-1">
        {sortBtns.map(({ k, label }) => (
          <button
            key={k}
            onClick={() => props.onChange({ sort: k as SortMode })}
            className={`px-3 py-1.5 rounded-full text-sm ${
              props.sort === (k as SortMode) ? "bg-violet-600 text-white" : "text-white hover:bg-zinc-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ========= main ========= */
function TrendingPageInner() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL or localStorage → state
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<{
        range: Range;
        shorts: ShortsMode;
        sort: SortMode;
      }>;
    } catch {
      return {};
    }
  })();

  const initRange = (search.get("range") as Range) || saved.range || "1d";
  const initShorts = ((search.get("shorts") as ShortsMode) || saved.shorts || "exclude") as ShortsMode;
  const initSort = (search.get("sort") as SortMode) || saved.sort || "trending";

  const [range, setRange] = useState<Range>(initRange);
  const [shorts, setShorts] = useState<ShortsMode>(initShorts);
  const [sort, setSort] = useState<SortMode>(initSort);

  const [items, setItems] = useState<Video[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 条件 → URL & localStorage 同期
  const syncQuery = (next?: Partial<{ range: Range; shorts: ShortsMode; sort: SortMode }>) => {
    const r = next?.range ?? range;
    const s = next?.shorts ?? shorts;
    const so = next?.sort ?? sort;
    const qs = new URLSearchParams(search.toString());
    qs.set("sort", so);
    qs.set("range", r);
    qs.set("shorts", s);
    router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
    localStorage.setItem(PREFS_KEY, JSON.stringify({ range: r, shorts: s, sort: so }));
  };

  // 条件が変わったら 1 ページ目から
  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(true);
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, shorts, sort]);

  async function fetchPage(p: number, replace = false) {
    if (loading || (!replace && !hasMore)) return;
    setLoading(true);
    try {
      // 既存の /api/videos を使用（route 重複を避ける）
      const qs = new URLSearchParams();
      qs.set("sort", sort);        // "trending" | "points" | "newest"
      qs.set("range", range);      // "1d" | "7d" | "30d"
      qs.set("shorts", shorts);    // "exclude" | "all"  ← API 側で除外に対応
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

  // 無限スクロール
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

  const listKey = `${range}-${shorts}-${sort}`;
  const label = range ===
