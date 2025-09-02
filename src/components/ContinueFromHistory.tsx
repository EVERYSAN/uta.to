// src/components/ContinueFromHistory.tsx
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Hist = { videoId: string; title?: string; at: number };

export default function ContinueFromHistory() {
  const [h, setH] = useState<Hist | null>(null);
  useEffect(() => {
    const raw = localStorage.getItem("lastVideo");
    if (raw) {
      try { setH(JSON.parse(raw)); } catch {}
    }
  }, []);
  if (!h) return null;
  return (
    <Link href={`/v/${h.videoId}`} className="inline-flex items-center gap-2 rounded-md bg-zinc-900 hover:bg-zinc-800 px-3 py-2 text-sm">
      ▶ 続きから見る{h.title ? `：${h.title}` : ""}
    </Link>
  );
}
