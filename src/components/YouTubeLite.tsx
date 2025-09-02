'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { toYouTubeId } from '@/utils/youtube';

type Props = {
  /** URLでもIDでもOK（shortsやwatch URL対応） */
  idOrUrl: string;
  title?: string;
  poster?: 'hqdefault' | 'mqdefault' | 'sddefault' | 'maxresdefault';
  noCookie?: boolean;
};

export default function YouTubeLite({
  idOrUrl,
  title = 'YouTube video',
  poster = 'hqdefault',
  noCookie = true,
}: Props) {
  const pathname = usePathname();
  const [loaded, setLoaded] = useState(false);
  const [origin, setOrigin] = useState<string>('');
  useEffect(() => setOrigin(window.location.origin), []);

  const id = useMemo(() => toYouTubeId(idOrUrl), [idOrUrl]);

  // 埋め込み不可/ID解決不可 → 直接YouTubeへ
  if (!id) {
    const watchUrl = toWatchUrl(idOrUrl);
    return (
      <div
        key={`${pathname}-invalid`}
        className="relative w-full max-w-[960px] aspect-video rounded-xl grid place-items-center bg-zinc-900 text-zinc-200"
      >
        <div className="text-center px-6">
          <p className="mb-3 font-semibold">この動画を埋め込み再生できません。</p>
          <a
            href={watchUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-4 py-2 text-sm font-medium"
          >
            YouTubeで開く ↗
          </a>
        </div>
      </div>
    );
  }

  const base = noCookie
    ? 'https://www.youtube-nocookie.com'
    : 'https://www.youtube.com';
  const thumb = `https://i.ytimg.com/vi/${id}/${poster}.jpg`;
  const embed =
    `${base}/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1` +
    (origin ? `&origin=${encodeURIComponent(origin)}` : '');

  return (
    <div
      key={`${pathname}-${id}`}
      className="relative w-full max-w-[960px] aspect-video overflow-hidden rounded-xl bg-black"
    >
      {!loaded ? (
        <button
          type="button"
          aria-label="Play video"
          onClick={() => setLoaded(true)} // クリック＝確実なユーザー操作
          className="group absolute inset-0 cursor-pointer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt={title}
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <span
            className="absolute inset-0 m-auto h-16 w-16 rounded-full bg-white/80 group-hover:bg-white/95 shadow
                       flex items-center justify-center text-black text-2xl"
            style={{ pointerEvents: 'none' }}
          >
            ▶
          </span>
        </button>
      ) : (
        <>
          <iframe
            title={title}
            src={embed}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="eager"
            className="absolute inset-0 h-full w-full border-0"
            referrerPolicy="strict-origin-when-cross-origin"
          />
          {/* 埋め込み禁止・地域制限などの保険として常にフォールバックボタンも表示 */}
          <a
            href={`https://www.youtube.com/watch?v=${id}`}
            target="_blank"
            rel="noreferrer"
            className="absolute right-2 bottom-2 rounded bg-white/90 text-black px-2 py-1 text-xs font-medium hover:bg-white"
          >
            再生できない？YouTubeで開く ↗
          </a>
        </>
      )}
    </div>
  );
}

function toWatchUrl(idOrUrl: string) {
  const id = toYouTubeId(idOrUrl);
  return id ? `https://www.youtube.com/watch?v=${id}` : idOrUrl;
}
