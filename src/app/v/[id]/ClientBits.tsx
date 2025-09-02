// src/app/[id]/ClientActions.tsx
"use client";

import { useEffect, useState } from "react";

export default function ClientActions({ videoId }: { videoId: string }) {
  return (
    <div className="flex items-center gap-2">
      <FavButton videoId={videoId} />
      <ShareButton />
    </div>
  );
}

function FavButton({ videoId }: { videoId: string }) {
  const key = "fav:v1";
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      const arr: string[] = raw ? JSON.parse(raw) : [];
      setOn(arr.includes(videoId));
    } catch {}
  }, [videoId]);

  const toggle = () => {
    try {
      const raw = localStorage.getItem(key);
      const arr: string[] = raw ? JSON.parse(raw) : [];
      const i = arr.indexOf(videoId);
      if (i >= 0) arr.splice(i, 1);
      else arr.unshift(videoId);
      localStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
      setOn(!on);
    } catch {}
  };

  return (
    <button
      onClick={toggle}
      className={`px-3 py-1.5 rounded-full text-sm ${
        on ? "bg-violet-600 text-white" : "bg-zinc-700 text-white hover:bg-zinc-600"
      }`}
      aria-pressed={on}
    >
      {on ? "お気に入り済み" : "お気に入り"}
    </button>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <button
      onClick={copy}
      className="px-3 py-1.5 rounded-full text-sm bg-zinc-700 text-white hover:bg-zinc-600"
    >
      {copied ? "コピーしました" : "共有リンク"}
    </button>
  );
}
