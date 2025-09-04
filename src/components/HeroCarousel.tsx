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
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (!items.length) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length]);

  const active = useMemo(() => items[idx], [items, idx]);
  if (err || !active) return null;

  return (
    <section className="mb-6">
      <div
        className={[
          // PC でデカくなりすぎないよう高さを制御
          "relative w-full overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/40",
          // 画面幅ごとにアスペクトを薄く + 高さ上限
          "aspect-[16/9] sm:aspect-[16/8] md:aspect-[21/9] lg:aspect-[21/8] xl:aspect-[21/7]",
          "max-h-[360px] md:max-h-[420px]",
        ].join(" ")}
      >
        <Link href={`/v/${active.id}`} className="block h-full w-full">
          <img
            src={active.thumbnailUrl ?? "/og.png"}
            alt={active.title}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = "/og.png";
            }}
          />
        </Link>

        {/* 下からの強めグラデ + 文字プレート */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          {/* 強めのスクラム（読めること最優先） */}
          <div className="h-28 md:h-32 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

          {/* テキスト＆ドットUI */}
          <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
              <div className="min-w-0">
                {/* タイトル：白＋テキストシャドウ＋半透明プレート */}
                <Link href={`/v/${active.id}`} className="pointer-events-auto">
                  <div
                    className={[
                      "inline-block rounded-md ring-1 ring-white/10",
                      "bg-black/55 backdrop-blur-[2px]",
                      "px-2.5 py-1.5 sm:px-3 sm:py-2",
                      "max-w-[92vw] sm:max-w-[80vw] md:max-w-[60vw]",
                    ].join(" ")}
                  >
                    <h2
                      className={[
                        "font-bold leading-snug text-white",
                        // モバイルは小さめ、PCで少しだけ大きく
                        "text-base sm:text-lg md:text-xl lg:text-2xl",
                        "line-clamp-2",
                      ].join(" ")}
                      // 文字のにじみ防止（読みにくい背景対策）
                      style={{
                        textShadow:
                          "0 1px 6px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.6)",
                      }}
                    >
                      {active.title}
                    </h2>
                  </div>
                </Link>

                {/* チャンネル名もプレート化して視認性UP */}
                <div className="mt-2">
                  <span className="inline-block rounded-md bg-black/45 px-2 py-1 text-xs sm:text-sm text-white/90 ring-1 ring-white/10 backdrop-blur-[1px]">
                    {active.channelTitle ?? "不明なチャンネル"}
                  </span>
                </div>
              </div>

              {/* インジケータ（クリック可） */}
              <div className="flex items-center gap-2 pointer-events-auto">
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
