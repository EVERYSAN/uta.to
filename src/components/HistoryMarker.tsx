// src/components/HistoryMarker.tsx
"use client";
import { useEffect } from "react";

export default function HistoryMarker({ videoId, title }: { videoId: string; title?: string | null }) {
  useEffect(() => {
    const payload = { videoId, title: title ?? "", at: Date.now() };
    try { localStorage.setItem("lastVideo", JSON.stringify(payload)); } catch {}
  }, [videoId, title]);
  return null;
}
