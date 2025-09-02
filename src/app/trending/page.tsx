// src/app/trending/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/* ===== utils ===== */
const nf = new Intl.NumberFormat("ja-JP");
const fmtCount = (n?: number | null) => (typeof n === "number" ? nf.format(n) : "0");
const fmtDate = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${HH}:${MM}`;
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

/* ===== types ===== */
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
  supportPoints?: number | null;
  trendingRank?: number | null;
};
type ApiList = { ok: boolean; items: Video[]; page?: number; take?: number; total?: number };

/* ===== “続きから” ===== */
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
      prefetch={false}
      className="inline-flex items-center gap-2 rounded-md bg-zinc-900 hover:bg-zinc-800 px-3 py-2 text-sm"
    >
      ▶ 続きから見る{h.title ? `：${h.title}` : ""}
    </Link>
  );
}

/* ===== バッジ ===== */
function TrendingBadge({ rank, label }: { rank?: number | null; label: string }) {
  const txt = rank ? `#${rank}` : "急上昇";
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-600/20 text-violet-300 px-2 py-0.5 text-[11px]">
      <span>⬆</span>
      <span className="font-medium">{txt}</span>
      <span className="opacity-70">/ {label}</span>
    </span>
  );
}

/* ===== カード ===== */
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
            alt={v.title ?? ""}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {typeof v.durationSec === "number" && (
          <span className="absolute right-2 bottom-2 text-[11px] bg-black/70 text-white px-1.5 py-0.5 rounded">
            {secsToLabel(v.durationSec)}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <TrendingBadge rank={v.trendingRank ?? null} label={label} />
          <span className="text-[11px] text-zinc-400">{fmtDate(v.publishedAt)}</span>
        </div>
        <h3 className="text-sm font-semibold leading-snug line-clamp-2 text-zinc-100">
          {v.title}
        </h3>
        <div className="flex items-center gap-3 text-[12px] text-zinc-400">
          <span>👁 {fmtCount(v.views)}</span>
          <span>❤️ {fmtCount(v.likes)}</span>
          {typeof v.supportPoints === "number" && <span>🔥 応援 {fmtCount(v.supportPoints)}</span>}
          {v.channelTitle && <span className="ml-auto truncate max-w-[50%] text-zinc-300">🎤 {v.channelTitle}</span>}
        </div>
      </div>
    </Link>
  );
}

/* ===== フィルタバー ===== */
type Range = "1d" | "7d" | "30d";
type ShortsMode = "exclude" | "all";
type SortMode = "trending" | "points" | "newest";
type Prefs = { range: Range; shorts: ShortsMode; sort: SortMode };
const PREFS_KEY = "video:prefs";

function FilterBar({
  prefs,
  onChange,
}: {
  prefs: Prefs;
  onChange: (next: Partial<Prefs>) => void;
}) {
  const Btn = ({
    active,
    children,
    onClick,
  }: {
    active: boolean;
    children: React.ReactNode;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm ${
        active ? "bg-violet-600 text-white" : "bg-zinc-800 text-white hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* range */}
      <Btn active={prefs.range === "1d"} onClick={() => onChange({ range: "1d" })}>
        24h
      </Btn>
      <Btn active={prefs.range === "7d"} onClick={() => onChange({ range: "7d" })}>
        7日
      </Btn>
      <Btn active={prefs.range === "30d"} onClick={() => onChange({ range: "30d" })}>
        30日
      </Btn>

      {/* shorts */}
      <div className="ml-2 inline-flex rounded-full bg-zinc-800 p-1">
        <Btn active={prefs.shorts === "exclude"} onClick={() => onChange({ shorts: "exclude" })}>
          ショート除外
        </Btn>
        <Btn active={prefs.shorts === "all"} onClick={() => onChange({ shorts: "all" })}>
          すべて
        </Btn>
      </div>

      {/* sort */}
      <div className="ml-2 inline-flex rounded-full bg-zinc-800 p-1">
        <Btn active={prefs.sort === "trending"} onClick={() => onChange({ sort: "trending" })}>
          急上昇
        </Btn>
        <Btn active={prefs.sort === "points"} onClick={() => onChange({ sort: "points" })}>
          応援順
        </Btn>
        <Btn active={prefs.sort === "newest"} onClick={() => onChange({ sort: "newest" })}>
          新着順
        </Btn>
      </div>
    </div>
  );
}

/* ===== main ===== */
export default function TrendingPage() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL / localStorage から初期値
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<Prefs>;
    } catch {
      return {};
    }
  }, []);
  const init: Prefs = {
    range: ((search.get("range") as Range) ?? (saved.range as Range) ?? "1d"),
    shorts: ((search.get("shorts") as ShortsMode) ?? (saved.shorts as ShortsMode) ?? "exclude"),
    sort: ((search.get("sort") as SortMode) ?? (saved.sort as SortMode) ?? "trending"),
  };

  const [prefs, setPrefs] = useState<Prefs>(init);
  const [items, setItems] = useState<Video[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // URL & localStorage 同期
  const sync = (next?: Partial<Prefs>) => {
    const merged: Prefs = { ...prefs, ...(next || {}) };
    const qs = new URLSearchParams(search.toString());
    qs.set("range", merged.range);
    qs.set("shorts", merged.shorts);
    qs.set("sort", merged.sort);
    router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
    localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
    setPrefs(merged);
  };

  // データ取得
  async function fetchPage(p: number, replace = false) {
    if (loading || (!replace && !hasMore)) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(p));
      qs.set("take", "24");
      // 既存 /api/videos に合わせたパラメータ（未対応でも無害）
      qs.set("range", prefs.range);          // "1d" | "7d" | "30d"
      qs.set("shorts", prefs.shorts);        // "exclude" | "all"
      qs.set("sort", prefs.sort);            // "trending" | "points" | "newest"

      const res = await fetch(`/api/videos?${qs.toString()}`, { cache: "no-store" });
      const json: ApiList = await res.json();
      const rows = json?.items ?? [];
      setItems((prev) => (replace ? rows : [...prev, ...rows]));
      if (rows.length < 24) setHasMore(false);
    } catch (e) {
      console.warn(e);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }

  // 条件が変わったらリセットして再取得
  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(true);
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.range, prefs.shorts, prefs.sort]);

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

  const label =
    prefs.range === "1d" ? "24時間" : prefs.range === "7d" ? "7日間" : "30日間";

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold">急上昇（ロング優先）</h1>
        <ContinueFromHistory />
      </div>

      <FilterBar prefs={prefs} onChange={sync} />

      <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {items.map((v) => (
          <VideoCard key={v.id} v={v} label={label} />
        ))}
      </section>

      <div ref={sentinelRef} />
      {loading && <div className="text-center text-sm text-zinc-400 py-4">読み込み中…</div>}
      {!loading && !hasMore && items.length > 0 && (
        <div className="text-center text-sm text-zinc-500 py-6">以上です</div>
      )}
      {!loading && items.length === 0 && (
        <div className="text-center text-sm text-zinc-500 py-10">該当する動画がありません</div>
      )}
    </main>
  );
}
