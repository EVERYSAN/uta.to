// src/components/HeroCarousel.tsx
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
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const r = await fetch("/api/hero", { cache: "no-store" });
        const j = await r.json();
        if (!stop) setItems(Array.isArray(j?.items) ? j.items : []);
      } catch (e: any) {
        if (!stop) setErr(e?.message ?? "fetch_error");
      }
    })();
    return () => { stop = true; };
  }, []);

  useEffect(() => {
    if (!items.length) return;
    const t = setInterval(() => setIdx(i => (i + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length]);

  const active = useMemo(() => items[idx], [items, idx]);
  if (err || !active) return null;

  return (
    <section className="mb-6">
      {/* 幅/高さを px 固定（モバイルは幅100%・高さ200px） */}
      <div className="mx-auto w-full md:w-[500px] xl:w-[680px]">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/40 h-[200px] md:h-[230px] xl:h-[260px]">
          <Link href={`/v/${active.id}`} className="block h-full w-full">
            <img
              src={active.thumbnailUrl ?? "/og.png"}
              alt={active.title}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </Link>

          {/* モバイル: タイトルは左上・小さめ */}
          <div className="pointer-events-none absolute left-2 top-2 sm:left-3 sm:top-3 md:hidden">
            <Link href={`/v/${active.id}`} className="pointer-events-auto">
              <h2
                className="inline-block rounded-md bg-black/60 px-2.5 py-1.5 text-sm sm:text-base font-bold leading-snug text-white ring-1 ring-white/10 line-clamp-2"
                style={{ textShadow: "0 1px 6px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.6)" }}
              >
                {active.title}
              </h2>
            </Link>
          </div>

          {/* 下からのグラデーション＋情報帯 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0">
            <div className="h-16 md:h-24 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-3 sm:p-4">
              {/* PC/タブレット: タイトルは下側 */}
              <div className="min-w-0 hidden md:block">
                <Link href={`/v/${active.id}`} className="pointer-events-auto">
                  <div className="inline-block rounded-md bg-black/55 px-3 py-2 ring-1 ring-white/10 backdrop-blur-[2px] max-w-[60vw]">
                    <h2
                      className="font-bold leading-snug text-white text-lg lg:text-xl line-clamp-2"
                      style={{ textShadow: "0 1px 6px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.6)" }}
                    >
                      {active.title}
                    </h2>
                  </div>
                </Link>
                <div className="mt-2">
                  <span className="inline-block rounded-md bg-black/45 px-2 py-1 text-sm text-white/90 ring-1 ring-white/10 backdrop-blur-[1px]">
                    {active.channelTitle ?? "不明なチャンネル"}
                  </span>
                </div>
              </div>

              {/* モバイル: チャンネル名は下側（位置そのまま） */}
              <div className="md:hidden">
                <span className="inline-block rounded-md bg-black/45 px-2 py-1 text-xs text-white/90 ring-1 ring-white/10 backdrop-blur-[1px]">
                  {active.channelTitle ?? "不明なチャンネル"}
                </span>
              </div>

              {/* ドットインジケータ */}
              <div className="ml-auto flex items-center gap-2 pointer-events-auto">
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
      </div>
    </section>
  );
}
