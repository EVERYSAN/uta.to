"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type HeroItem = {
  id: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  supportPoints: number | null;
};

export default function HeroCarousel() {
  const [items, setItems] = useState<HeroItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await fetch("/api/hero", { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const json = await r.json();
        const arr: HeroItem[] = Array.isArray(json?.items) ? json.items : [];
        if (!cancelled) {
          setItems(arr);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "fetch_error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 5秒ごとに自動スライド（アイテムがある時だけ）
  useEffect(() => {
    if (items.length === 0) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % items.length);
    }, 5000);
    return () => clearInterval(t);
  }, [items.length]);

  const active = useMemo(() => items[idx], [items, idx]);

  // 何も出せるものがないなら静かに何も描画しない（クラッシュ防止）
  if (err || items.length === 0 || !active) {
    return null;
  }

  return (
    <section className="mb-6">
      <div className="relative w-full overflow-hidden rounded-2xl bg-neutral-900/40 border border-white/10">
        {/* サムネイル */}
        <Link href={`/v/${active.id}`} className="block">
          {/* next/image だと外部ドメイン許可が必要なので img を使用 */}
          <img
            src={active.thumbnailUrl ?? "/og.png"}
            alt={active.title}
            className="aspect-[16/6] w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = "/og.png";
            }}
          />
        </Link>

        {/* テキストオーバーレイ */}
        <div className="absolute inset-x-0 bottom-0 p-4 md:p-6 bg-gradient-to-t from-black/70 to-transparent">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/v/${active.id}`}>
                <h2 className="text-xl md:text-2xl font-bold line-clamp-2">
                  {active.title}
                </h2>
              </Link>
              <p className="text-sm opacity-80 mt-1 line-clamp-1">
                {active.channelTitle ?? "不明なチャンネル"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {items.map((_, i) => (
                <button
                  key={i}
                  aria-label={`slide ${i + 1}`}
                  onClick={() => setIdx(i)}
                  className={`h-2 w-2 rounded-full transition-all ${
                    i === idx ? "w-6 bg-white" : "bg-white/40 hover:bg-white/70"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
