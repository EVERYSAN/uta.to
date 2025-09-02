'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

type Props = {
  id: string;                 // YouTube 動画ID
  title?: string;
  poster?: 'hqdefault' | 'mqdefault' | 'sddefault' | 'maxresdefault';
  noCookie?: boolean;
};

export default function YouTubeLite({
  id,
  title = 'YouTube video',
  poster = 'hqdefault',
  noCookie = true,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname(); // ルート遷移で key を変えて再マウント

  const base = noCookie
    ? 'https://www.youtube-nocookie.com'
    : 'https://www.youtube.com';

  const thumb = `https://i.ytimg.com/vi/${id}/${poster}.jpg`;
  const embed = `${base}/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;

  return (
    <div
      key={`${pathname}-${id}`}
      className="relative w-full max-w-[960px] aspect-video overflow-hidden rounded-xl bg-black"
    >
      {!loaded ? (
        <button
          type="button"
          aria-label="Play video"
          onClick={() => setLoaded(true)} // クリック＝ユーザー操作→再生OK
          className="group absolute inset-0"
          style={{ cursor: 'pointer' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt={title}
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          {/* 再生ボタン */}
          <span
            className="absolute inset-0 m-auto h-16 w-16 rounded-full bg-white/80 group-hover:bg-white/95 shadow
                       flex items-center justify-center text-black text-2xl"
            style={{ pointerEvents: 'none' }}
          >
            ▶
          </span>
        </button>
      ) : (
        <iframe
          title={title}
          src={embed}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="eager"
          className="absolute inset-0 h-full w-full border-0"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
    </div>
  );
}
