'use client';

import { useMemo, useState } from 'react';

type Props = {
  /** YouTubeのIDでもURLでもOK（watch?v=..., youtu.be, /shorts/... に対応） */
  idOrUrl: string;
  title?: string;
  poster?: 'hqdefault' | 'mqdefault' | 'sddefault' | 'maxresdefault';
  noCookie?: boolean;

  /** 縦動画かどうか（未指定なら URL が /shorts/ を含む場合に自動推定） */
  isVertical?: boolean;

  /** 枠の下にだけ「YouTubeで開く」を出したい時（モバイルの邪魔回避のため既定 false） */
  showOpenExternal?: boolean;
};

export default function YouTubeLite({
  idOrUrl,
  title = 'YouTube video',
  poster = 'hqdefault',
  noCookie = true,
  isVertical,
  showOpenExternal = false,
}: Props) {
  const [loaded, setLoaded] = useState(false);

  const { id, verticalGuess } = useMemo(() => {
    const id = toYouTubeId(idOrUrl);
    const verticalGuess =
      typeof isVertical === 'boolean'
        ? isVertical
        : /(^|\/)shorts(\/|$)/.test(idOrUrl);
    return { id, verticalGuess };
  }, [idOrUrl, isVertical]);

  // IDを解決できない場合は枠内で静的フォールバック
  if (!id) {
    const watch = toWatchUrl(idOrUrl);
    return (
      <div className="w-full aspect-video grid place-items-center rounded-xl bg-zinc-900 text-zinc-100">
        <div className="text-center px-6">
          <p className="mb-3 font-semibold">この動画は埋め込み再生できません。</p>
          <a
            href={watch}
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
  const embed = `${base}/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;

  // 縦動画→モバイルでは 9:16、sm以上は 16:9 に戻す
  const isVerticalFinal = verticalGuess === true;
  const wrapperClass = isVerticalFinal
    ? 'relative w-full overflow-hidden rounded-xl bg-black aspect-[9/16] sm:aspect-video'
    : 'relative w-full overflow-hidden rounded-xl bg-black aspect-video';

  return (
    <>
      <div className={wrapperClass}>
        {!loaded ? (
          <button
            type="button"
            aria-label="Play video"
            onClick={() => setLoaded(true)}
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

      {showOpenExternal && (
        <div className="mt-2 text-xs">
          <a
            href={`https://www.youtube.com/watch?v=${id}`}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-400 underline hover:text-zinc-200"
          >
            再生できない？YouTubeで開く ↗
          </a>
        </div>
      )}
    </>
  );
}

/* ---------------- utils ---------------- */

function toYouTubeId(input?: string | null): string | null {
  if (!input) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);

    // youtu.be/VIDEOID
    if (host === 'youtu.be' && parts[0] && /^[\w-]{11}/.test(parts[0])) {
      return parts[0].substring(0, 11);
    }
    // youtube.com/watch?v=VIDEOID
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}/.test(v)) return v.substring(0, 11);
    // /embed/VIDEOID
    const i = parts.indexOf('embed');
    if (i >= 0 && parts[i + 1] && /^[\w-]{11}/.test(parts[i + 1])) {
      return parts[i + 1].substring(0, 11);
    }
    // /shorts/VIDEOID
    if (parts[0] === 'shorts' && parts[1] && /^[\w-]{11}/.test(parts[1])) {
      return parts[1].substring(0, 11);
    }
  } catch {
    /* noop */
  }
  const m = input.match(/([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function toWatchUrl(idOrUrl: string) {
  const id = toYouTubeId(idOrUrl);
  return id ? `https://www.youtube.com/watch?v=${id}` : idOrUrl;
}
