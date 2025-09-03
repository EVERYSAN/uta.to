// src/app/trending/page.tsx
import Link from "next/link";

type Item = {
  id: string;
  title: string;
  url: string | null;
  platform: string;
  platformVideoId: string | null;
  thumbnailUrl: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  publishedAt: string | null;
  views?: number;
  likes?: number;
  supportInRange?: number;
  trendingRank?: number | null;
};

type ApiResponse = {
  ok: boolean;
  items: Item[];
  page: number;
  take: number;
  total: number;
};

const RANGES: Array<"1d" | "7d" | "30d"> = ["1d", "7d", "30d"];

function qs(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

function secondsToLabel(sec: number | null | undefined) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: { range?: "1d" | "7d" | "30d"; page?: string; shorts?: "exclude" | "all" };
}) {
  const range = searchParams.range ?? "1d";
  const page = Math.max(1, Number(searchParams.page ?? "1"));
  const shorts = searchParams.shorts ?? "exclude";

  const res = await fetch(
    `/api/videos?${qs({
      range,
      page,
      take: 24,
      sort: "trending",
      shorts,
    })}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    throw new Error(`Failed to load videos (${res.status})`);
  }

  const data = (await res.json()) as ApiResponse;
  const { items, total, take } = data;

  const hasPrev = page > 1;
  const hasNext = page * take < total;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Range tabs */}
      <div className="flex gap-2">
        {RANGES.map((r) => {
          const active = r === range;
          return (
            <Link
              key={r}
              href={`/trending?${qs({ range: r, page: 1, shorts })}`}
              className={`px-3 py-1 rounded-full border ${active ? "bg-black text-white" : "bg-white"}`}
            >
              {r === "1d" ? "24h" : r === "7d" ? "7日" : "30日"}
            </Link>
          );
        })}

        {/* Shorts toggle */}
        <div className="ml-auto flex gap-2">
          <Link
            href={`/trending?${qs({ range, page: 1, shorts: "exclude" })}`}
            className={`px-3 py-1 rounded-full border ${shorts === "exclude" ? "bg-black text-white" : "bg-white"}`}
          >
            ロングのみ
          </Link>
          <Link
            href={`/trending?${qs({ range, page: 1, shorts: "all" })}`}
            className={`px-3 py-1 rounded-full border ${shorts === "all" ? "bg-black text-white" : "bg-white"}`}
          >
            すべて
          </Link>
        </div>
      </div>

      {/* grid */}
      <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it, idx) => {
          const rank = it.trendingRank ?? (page - 1) * take + (idx + 1);
          const isLong = it.durationSec == null ? true : it.durationSec >= 61; // 61秒からロング
          return (
            <li key={it.id} className="rounded-xl border p-3 flex gap-3">
              <div className="text-2xl font-bold w-12 text-right">{rank}</div>
              <div className="flex-1">
                <div className="flex gap-3">
                  {it.thumbnailUrl ? (
                    <img
                      src={it.thumbnailUrl}
                      alt={it.title}
                      className="w-32 h-20 object-cover rounded-md"
                    />
                  ) : (
                    <div className="w-32 h-20 bg-gray-100 rounded-md" />
                  )}
                  <div className="flex-1">
                    <div className="font-semibold line-clamp-2">{it.title}</div>
                    <div className="text-sm text-gray-500">
                      {it.channelTitle ?? "—"} ・ {secondsToLabel(it.durationSec)} ・{" "}
                      {isLong ? "LONG" : "SHORT"}
                    </div>
                    <div className="text-xs text-gray-500">
                      応援: {it.supportInRange ?? 0}
                    </div>
                  </div>
                </div>
                {it.url && (
                  <div className="mt-2">
                    <a
                      href={it.url}
                      target="_blank"
                      className="text-sm underline text-blue-600"
                    >
                      視聴する
                    </a>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* pager */}
      <div className="flex items-center justify-between">
        <Link
          href={`/trending?${qs({ range, page: page - 1, shorts })}`}
          className={`px-3 py-1 rounded border ${hasPrev ? "" : "pointer-events-none opacity-40"}`}
        >
          ← 前へ
        </Link>
        <div className="text-sm text-gray-500">
          {total === 0 ? "0件" : `${(page - 1) * take + 1}–${Math.min(page * take, total)} / ${total}件`}
        </div>
        <Link
          href={`/trending?${qs({ range, page: page + 1, shorts })}`}
          className={`px-3 py-1 rounded border ${hasNext ? "" : "pointer-events-none opacity-40"}`}
        >
          次へ →
        </Link>
      </div>
    </main>
  );
}
