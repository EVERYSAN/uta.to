// FILE: src/app/trending/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
  supportInRange?: number | null; // 期間内応援ポイント
  trendingRank?: number | null;
};
type ApiList = { ok: boolean; items: Video[]; page?: number; take?: number; total?: number };

/* ===== badge ===== */
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

/* ===== card ===== */
function VideoCard({ v, rangeLabel }: { v: Video; rangeLabel: string }) {
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
          <TrendingBadge rank={v.trendingRank ?? null} label={rangeLabel} />
          <span className="text-[11px] text-zinc-400">{fmtDate(v.publishedAt)}</span>
        </div>
        <h3 className="text-sm font-semibold leading-snug line-clamp-2 text-zinc-100">
          {v.title}
        </h3>
        <div className="flex items-center gap-3 text-[12px] text-zinc-400">
          <span>👁 {fmtCount(v.views)}</span>
          <span>❤️ {fmtCount(v.likes)}</span>
          <span>🔥 {rangeLabel === "24時間" ? "今日の応援" : `${rangeLabel}の応援`} {fmtCount(v.supportInRange ?? 0)}</span>
          {v.channelTitle && (
            <span className="ml-auto truncate max-w-[50%] text-zinc-300">🎤 {v.channelTitle}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ===== filters ===== */
type Range = "1d" | "7d" | "30d";
type ShortsMode = "exclude" | "all";
type SortMode = "trending" | "points"; // 「新着順」は削除
type Prefs = { range: Range; shorts: ShortsMode; sort: SortMode };
const PREFS_KEY = "video:prefs";

function FilterBar({ prefs, onChange }: { prefs: Prefs; onChange: (next: Partial<Prefs>) => void }) {
  const Btn = ({
    active,
    children,
    onClick,
  }: { active: boolean; children: React.ReactNode; onClick: () => void }) => (
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
      <Btn active={prefs.range === "1d"} onClick={() => onChange({ range: "1d" })}>24h</Btn>
      <Btn active={prefs.range === "7d"} onClick={() => onChange({ range: "7d" })}>7日</Btn>
      <Btn active={prefs.range === "30d"} onClick={() => onChange({ range: "30d" })}>30日</Btn>

      {/* shorts（文言を「ロング動画」に変更） */}
      <div className="ml-2 inline-flex rounded-full bg-zinc-800 p-1">
        <Btn active={prefs.shorts === "exclude"} onClick={() => onChange({ shorts: "exclude" })}>
          ロング動画
        </Btn>
        <Btn active={prefs.shorts === "all"} onClick={() => onChange({ shorts: "all" })}>
          すべて
        </Btn>
      </div>

      {/* sort（新着順トグルは削除） */}
      <div className="ml-2 inline-flex rounded-full bg-zinc-800 p-1">
        <Btn active={prefs.sort === "trending"} onClick={() => onChange({ sort: "trending" })}>急上昇</Btn>
        <Btn active={prefs.sort === "points"} onClick={() => onChange({ sort: "points" })}>応援順</Btn>
      </div>
    </div>
  );
}

/* ===== main ===== */
export default function TrendingPage() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<Prefs>;
    } catch {
      return {};
    }
  }, []);

  const coerceSort = (s?: string | null): SortMode =>
    s === "trending" || s === "points" ? (s as SortMode) : "trending";

  const init: Prefs = {
    range: ((search.get("range") as Range) ?? (saved.range as Range) ?? "1d"),
    shorts: ((search.get("shorts") as ShortsMode) ?? (saved.shorts as ShortsMode) ?? "exclude"),
    sort: coerceSort((search.get("sort") as string) ?? (saved.sort as string) ?? "trending"),
  };

  const [prefs, setPrefs] = useState<Prefs>(init);
  const [items, setItems] = useState<Video[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const rangeLabel = prefs.range === "1d" ? "24時間" : prefs.range === "7d" ? "7日間" : "30日間";

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

  async function fetchPage(p: number, replace = false) {
    if (loading || (!replace && !hasMore)) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(p));
      qs.set("take", "24");
      qs.set("range", prefs.range);
      qs.set("shorts", prefs.shorts);
      qs.set("sort", prefs.sort);

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

  // 条件変化でリセット
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

  return (
    <main className="mx-auto max-w-7xl px-0 md:px-4 py-4 md:py-6 space-y-4">
      <h1 className="px-4 text-2xl md:text-3xl font-bold">急上昇（ロング優先）</h1>

      <div className="px-4">
        <FilterBar prefs={prefs} onChange={sync} />
      </div>

      <section className="px-4 grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {items.map((v) => (
          <VideoCard key={v.id} v={v} rangeLabel={rangeLabel} />
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
