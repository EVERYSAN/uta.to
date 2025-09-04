"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type Item = {
  id: string;
  platformVideoId: string;
  title: string;
  channelTitle: string | null;
  url: string;
  thumbnailUrl: string | null;
  supportPoints: number;
  views: number | null;
  publishedAt: Date;
};

export default function HeroCarouselClient({ items }: { items: Item[] }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = items.length;

  const current = items[idx];

  // 自動送り（5秒）
  useEffect(() => {
    if (paused) return;
    timer.current && clearInterval(timer.current);
    timer.current = setInterval(() => {
      setIdx((i) => (i + 1) % total);
    }, 5000);
    return () => {
      timer.current && clearInterval(timer.current);
    };
  }, [paused, total]);

  const go = (n: number) => setIdx(((n % total) + total) % total);
  const next = () => go(idx + 1);
  const prev = () => go(idx - 1);

  const bg = useMemo(
    () => current?.thumbnailUrl ?? `https://i.ytimg.com/vi/${current?.platformVideoId}/maxresdefault.jpg`,
    [current]
  );

  return (
    <section
      className="relative mb-6 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="おすすめスライドショー"
    >
      {/* 背景サムネ */}
      <div className="relative h-[220px] w-full md:h-[280px]">
        <Image
          src={bg}
          alt={current?.title ?? ""}
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
      </div>

      {/* 情報レイヤ */}
      <div className="absolute inset-0 p-4 md:p-6 flex items-end">
        <div className="max-w-3xl">
          <a
            href={`/v/${current.platformVideoId}`}
            className="inline-block text-2xl md:text-3xl font-bold text-white hover:underline drop-shadow"
          >
            {current.title}
          </a>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-200">
            {current.channelTitle && (
              <span className="rounded-full bg-zinc-900/70 border border-zinc-700 px-2 py-0.5">
                {current.channelTitle}
              </span>
            )}
            <span className="rounded-full bg-fuchsia-600/20 border border-fuchsia-500/40 text-fuchsia-200 px-2 py-0.5">
              応援 {current.supportPoints.toLocaleString()} pt
            </span>
            {typeof current.views === "number" && (
              <span className="rounded-full bg-zinc-900/70 border border-zinc-700 px-2 py-0.5">
                再生 {current.views.toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 前後ボタン */}
      <button
        onClick={prev}
        aria-label="前へ"
        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 hover:bg-black/70 p-2 text-white"
      >
        ‹
      </button>
      <button
        onClick={next}
        aria-label="次へ"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 hover:bg-black/70 p-2 text-white"
      >
        ›
      </button>

      {/* ドット */}
      <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-2">
        {items.map((_, i) => (
          <button
            key={i}
            aria-label={`スライド ${i + 1}`}
            onClick={() => go(i)}
            className={[
              "h-2.5 w-2.5 rounded-full border border-white/50",
              i === idx ? "bg-white" : "bg-transparent",
            ].join(" ")}
          />
        ))}
      </div>
    </section>
  );
}
