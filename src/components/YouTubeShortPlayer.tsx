"use client";
// src/components/YouTubeShortPlayer.tsx
import React from "react";

type Props = {
  videoId: string;
  title?: string;
  isShort?: boolean;   // 60秒以下 or shorts URLなら true
  autoPlay?: boolean;  // 必要なら自動再生（モバイルはmute必須）
};

export default function YouTubeShortPlayer({
  videoId,
  title = "video",
  isShort = false,
  autoPlay = false,
}: Props) {
  const params = new URLSearchParams({
    autoplay: autoPlay ? "1" : "0",
    mute: autoPlay ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    fs: "0",
    enablejsapi: "1",
    // SSRでも動くように window 未定義は空文字でOK
    origin:
      typeof window !== "undefined" ? window.location.origin : "",
  });

  const src = `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;

  return (
    <div className={isShort ? "short-embed" : "wide-embed"}>
      <iframe
        className="embed-iframe"
        title={title}
        src={src}
        allow="autoplay; encrypted-media; picture-in-picture; gyroscope"
        allowFullScreen
        referrerPolicy="origin-when-cross-origin"
      />
      <style jsx>{`
        .wide-embed {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #000;
          border-radius: 1rem;
          overflow: hidden;
        }
        .short-embed {
          position: relative;
          width: 100%;
          max-width: 100%;
          aspect-ratio: 9 / 16;
          background: #000;
          border-radius: 1rem;
          overflow: hidden;
        }
        @media (max-width: 640px) {
          /* スマホは画面いっぱいに */
          .short-embed {
            width: 100vw;
            height: 100svh; /* iOSのセーフエリア対応 */
            aspect-ratio: auto;
            border-radius: 0;
          }
        }
        .embed-iframe {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
        }
      `}</style>
    </div>
  );
}
