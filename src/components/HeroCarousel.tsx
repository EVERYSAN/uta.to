// src/components/HeroCarousel.tsx
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

type Video = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  channelTitle?: string;
  supportPoints?: number | null;
};

async function fetchSupportTop(take = 10): Promise<Video[]> {
  try {
    const qs = new URLSearchParams({
      sort: 'support',
      range: '1d',
      shorts: 'all',
      page: '1',
      take: String(take),
    });
    const res = await fetch(`/api/videos?${qs.toString()}`, { cache: 'no-store' });
    const json = await res.json();
    return Array.isArray(json?.items) ? json.items : [];
  } catch (e) {
    console.error('[HeroCarousel] fetch error', e);
    return [];
  }
}

/**
 * 上部ヒーローのカルーセル。
 * - NEXT_PUBLIC_HERO_PINNED_IDS=「/v/:id」に出てくる内部IDをカンマ区切りで
 *   2件まで指定可能（例: abc123,def456）
 * - 残りは応援(24h)の上位から自動で補完
 */
export default function HeroCarousel({ size = 5 }: { size?: number }) {
  const [rows, setRows] = useState<Video[]>([]);
  const [idx, setIdx] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const pinnedIds = (process.env.NEXT_PUBLIC_HERO_PINNED_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const candidates = await fetchSupportTop(12);

      // ピン留め（指定順を優先）
      const byId = new Map(candidates.map((v) => [v.id, v]));
      const pinned = pinnedIds
        .map((id) => byId.get(id))
        .filter(Boolean) as Video[];

      // 重複除去して残りを補完
      const pinnedSet = new Set(pinned.map((v) => v.id));
      const rest = candidates.filter((v) => !pinnedSet.has(v.id));

      const finalRows = [...pinned, ...rest].slice(0, size);

      if (!cancelled) setRows(finalRows);
    })();

    return () => {
      cancelled = true;
    };
  }, [size]);

  // 自動スライド
  useEffect(() => {
    if (rows.length <= 1) return;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setIdx((i) => (i + 1) % rows.length);
    }, 6000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [rows.length]);

  if (rows.length === 0) return null;

  const cur = rows[idx];

  return (
    <div className="relative mb-4 overflow-hidden rounded-2xl bg-zinc-900 aspect-[21/9]">
      {cur.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cur.thumbnailUrl}
          alt={cur.title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-tr from-black/70 via-black/30 to-transparent" />

      <div className="absolute inset-0 flex items-end p-6">
        <div className="max-w-3xl">
          <div className="text-xs text-zinc-300 mb-1">💜 {cur.supportPoints ?? 0} pt</div>
          <Link
            href={`/v/${cur.id}`}
            className="block text-xl md:text-2xl font-bold text-white leading-tight line-clamp-2 hover:underline"
            prefetch={false}
          >
            {cur.title}
          </Link>
          {cur.channelTitle && (
            <div className="text-sm text-zinc-300 mt-1">🎤 {cur.channelTitle}</div>
          )}
        </div>
      </div>

      {/* ドットインジケータ */}
      <div className="absolute right-4 bottom-4 flex gap-2">
        {rows.map((_, i) => (
          <button
            key={i}
            aria-label={`slide ${i + 1}`}
            onClick={() => setIdx(i)}
            className={`h-2 w-2 rounded-full ${i === idx ? 'bg-white' : 'bg-white/40'}`}
          />
        ))}
      </div>
    </div>
  );
}
