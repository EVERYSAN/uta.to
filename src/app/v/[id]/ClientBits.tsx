"use client";

import { useEffect, useState } from "react";

type Props = { videoId: string };

export default function ClientBits({ videoId }: Props) {
  const [fav, setFav] = useState(false);
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/v/${videoId}`
      : "";

  // 初期化：localStorage から読み込み
  useEffect(() => {
    try {
      const raw = localStorage.getItem("favVideos");
      const set = new Set<string>(raw ? JSON.parse(raw) : []);
      setFav(set.has(videoId));
    } catch {}
  }, [videoId]);

  const toggleFav = () => {
    try {
      const raw = localStorage.getItem("favVideos");
      const arr: string[] = raw ? JSON.parse(raw) : [];
      const set = new Set(arr);
      if (set.has(videoId)) set.delete(videoId);
      else set.add(videoId);
      localStorage.setItem("favVideos", JSON.stringify([...set]));
      setFav(set.has(videoId));
    } catch {}
  };

  const doShare = async () => {
    try {
      // Web Share API があれば
      if (navigator.share) {
        await navigator.share({ url: shareUrl });
        return;
      }
      // なければクリップボードへ
      await navigator.clipboard.writeText(shareUrl);
      alert("リンクをコピーしました");
    } catch {}
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleFav}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          fav
            ? "bg-violet-600 text-white"
            : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
        }`}
        aria-pressed={fav}
      >
        {fav ? "★ お気に入り" : "☆ お気に入り"}
      </button>

      <button
        onClick={doShare}
        className="rounded-full px-3 py-1 text-xs font-medium bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
      >
        共有
      </button>
    </div>
  );
}
