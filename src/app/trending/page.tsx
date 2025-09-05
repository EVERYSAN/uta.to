// src/app/trending/page.tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import HeroCarousel from "@/components/HeroCarousel";

export const dynamic = "force-dynamic";

/* ========= utils ========= */
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
  if (s == null) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

/* ========= types ========= */
type SortMode = "trending" | "support";
type Range = "1d" | "7d" | "30d";
type ShortsMode = "all" | "exclude";

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
  /** APIが返す期間内の応援ポイント（件数） */
  supportPoints?: number | null;
  /** （もしAPIが返すなら）応援順位 */
  supportRank?: number | null;
};
type ApiList = { ok: boolean; items: Video[]; page?: number; take?: number; total?: number };

/* ========= badges ========= */
function TrendingBadge({ rank, range }: { rank?: number | null; range: Range }) {
  const label = rank ? `#${rank}` : "急上昇";
  const rangeText = range === "1d" ? "24時間" : range === "7d" ? "7日間" : "30日間";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-violet-600/20 text-violet-300 px-2 py-0.5 text-[11px]">
      <span>⬆</span><span className="font-medium">{label}</span>
      <span className="opacity-70">/ {rangeText}</span>
    </div>
  );
}

function SupportBadge({ points, rank, range }: { points?: number | null; rank?: number | null; range: Range }) {
  const rangeText = range === "1d" ? "24時間" : range === "7d" ? "7日間" : "30日間";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-rose-600/20 text-rose-300 px-2 py-0.5 text-[11px]">
      <span>📣</span>
      <span className="font-medium">{fmtCount(points)} pt</span>
      {rank ? <span className="opacity-70">/ #{rank}</span> : null}
      <span className="opacity-70"> / {rangeText}</span>
    </div>
  );
}

/* ========= card ========= */
function VideoCard({ v, range, sort }: { v: Video; range: Range; sort: SortMode }) {
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
          {sort === "support" ? (
            <SupportBadge points={v.supportPoints ?? 0} rank={v.supportRank ?? null} range={range} />
          ) : (
            <TrendingBadge rank={v.trendingRank ?? null} range={range} />
          )}
          <div className="text-[11px] text-zinc-400">{fmtDate(v.publishedAt)}</div>
        </div>

        <h3 className="text-sm font-semibold leading-snug line-clamp-2 text-zinc-100">{v.title}</h3>

        <div className="flex items-center gap-3 text-[12px] text-zinc-400">
          <span className="inline-flex items-center gap-1">👁 {fmtCount(v.views)}</span>
          <span className="inline-flex items-center gap-1">❤️ {fmtCount(v.likes)}</span>
          {/* 急上昇のときもサブ情報で期間内の応援ptを表示 */}
          {sort === "trending" && (
            <span className="inline-flex items-center gap-1">📣 {fmtCount(v.supportPoints)} pt</span>
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
function FilterBar({
  range, shorts, sort, onChange,
}: {
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
    { k: "all", label: "すべて" },
    { k: "exclude", label: "ショート除外" },
  ] as const;

  const sortBtns = [
    { k: "trending", label: "急上昇" },
    { k: "support", label: "応援" },
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {rangeBtns.map(({ k, label }) => (
        <button
          key={k}
          onClick={() => onChange({ range: k as Range })}
          className={`px-3 py-1.5 rounded-full text-sm ${
            range === k ? "bg-violet-600 text-white" : "bg-zinc-800 text-white hover:bg-zinc-700"
          }`}
        >
          {label}
        </button>
      ))}

      <div className="ml-2 inline-flex rounded-full bg-zinc-800 p-1">
        {shortsBtns.map(({ k, label }) => (
          <button
            key={k}
            onClick={() => onChange({ shorts: k as ShortsMode })}
            className={`px-3 py-1.5 rounded-full text-sm ${
              shorts === k ? "bg-violet-600 text-white" : "text-white hover:bg-zinc-700"
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
            onClick={() => onChange({ sort: k as SortMode })}
            className={`px-3 py-1.5 rounded-full text-sm ${
              sort === k ? "bg-violet-600 text-white" : "text-white hover:bg-zinc-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <span className="text-xs text-zinc-500 ml-auto">並び: {sort === "support" ? "応援" : "急上昇"}</span>
    </div>
  );
}


/* ========= main ========= */
function TrendingPageInner() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const initRange = (search.get("range") as Range) || "1d";
  const rawShorts = (search.get("shorts") as ShortsMode | "only") || "all";
  const initShorts: ShortsMode = rawShorts === "exclude" ? "exclude" : "all";
  const initSort = (search.get("sort") as SortMode) || "trending";

  const [range, setRange] = useState<Range>(initRange);
  const [shorts, setShorts] = useState<ShortsMode>(initShorts);
  const [sort, setSort] = useState<SortMode>(initSort);

  const [items, setItems] = useState<Video[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 条件 → URL 同期
  const syncQuery = (next?: Partial<{ range: Range; shorts: ShortsMode; sort: SortMode }>) => {
    const r = next?.range ?? range;
    const s = next?.shorts ?? shorts;
    const so = next?.sort ?? sort;
    const qs = new URLSearchParams(search.toString());
    qs.set("sort", so);
    qs.set("range", r);
    qs.set("shorts", s);
    router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
  };

  // 条件が変わったら 1 ページ目から読み直し
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
      const qs = new URLSearchParams();
      qs.set("sort", sort);                 // ← 並び替え（trending/support）
      qs.set("range", range);               // ← 24h/7d/30d を常に付与
      qs.set("shorts", shorts);             // ← ショート除外対応
      qs.set("page", String(p));
      qs.set("take", "24");
      qs.set("ts", String(Date.now()));    // ← 追加: 毎回URLをユニークにして確実に最新を取る

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

  // 初回：URL→state 同期（古い &shorts=only も all に寄せる）
  useEffect(() => {
    const r = (search.get("range") as Range) || "1d";
    const sRaw = (search.get("shorts") as ShortsMode | "only") || "all";
    const s: ShortsMode = sRaw === "exclude" ? "exclude" : "all";
    const so = (search.get("sort") as SortMode) || "trending";
    setRange(r);
    setShorts(s);
    setSort(so);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 初回のみ

  const listKey = `${range}-${shorts}-${sort}`;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between" />
      
      <HeroCarousel />
      
      <FilterBar
        range={range}
        shorts={shorts}
        sort={sort}
        onChange={(next) => {
          if (next.range) setRange(next.range);
          if (next.shorts) setShorts(next.shorts);
          if (next.sort) setSort(next.sort);
          syncQuery(next);
        }}
      />

      <section
        key={listKey}
        className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      >
        {items.map((v) => (
          <VideoCard key={v.id} v={v} range={range} sort={sort} />
        ))}
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

/* ========= Suspense ========= */
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
