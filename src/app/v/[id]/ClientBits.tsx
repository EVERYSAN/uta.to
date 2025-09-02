"use client";

import { useEffect, useState } from "react";

export function FavButton({ videoId }: { videoId: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("favVideos");
    if (!raw) return;
    try {
      const set = new Set<string>(JSON.parse(raw));
      setOn(set.has(videoId));
    } catch {}
  }, [videoId]);

  const toggle = () => {
    const raw = localStorage.getItem("favVideos");
    const set = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    if (set.has(videoId)) set.delete(videoId);
    else set.add(videoId);
    localStorage.setItem("favVideos", JSON.stringify([...set]));
    setOn((v) => !v);
  };

  return (
    <button
      onClick={toggle}
      className={`rounded-lg px-3 py-1.5 text-sm border ${
        on
          ? "border-violet-500 bg-violet-500/10 text-violet-300"
          : "border-zinc-800 text-zinc-300 hover:bg-zinc-800"
      }`}
      title="お気に入り"
    >
      {on ? "★ お気に入り" : "☆ お気に入り"}
    </button>
  );
}

export function ShareButton() {
  const [done, setDone] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      // 失敗時は無視
    }
  };

  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
      title="リンクをコピー"
    >
      {done ? "コピーしました" : "共有"}
    </button>
  );
}
