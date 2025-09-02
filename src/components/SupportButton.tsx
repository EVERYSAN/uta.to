// src/components/SupportButton.tsx
"use client";
import { useState } from "react";

export default function SupportButton({ videoId, initialPoints = 0 }: { videoId: string; initialPoints?: number }) {
  const [points, setPoints] = useState(initialPoints);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<boolean>(() => !!localStorage.getItem(`support:${videoId}:done`));

  const send = async () => {
    if (busy || done) return;
    setBusy(true);
    try {
      const res = await fetch("/api/support", { method: "POST", body: JSON.stringify({ videoId, amount: 1 }) });
      const json = await res.json();
      if (json.ok) {
        setPoints(json.points);
        setDone(true);
        localStorage.setItem(`support:${videoId}:done`, "1"); // ざっくり1日1回分のフラグ
      } else {
        console.warn(json);
        alert(json.error || "エラーが発生しました");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={send}
      disabled={busy || done}
      className={`px-3 py-1.5 rounded-md text-sm font-medium ${done ? "bg-green-700/50 text-green-200" : "bg-violet-600 hover:bg-violet-500 text-white"}`}
      title={done ? "今日の応援ありがとうございます！" : "この動画を応援する"}
    >
      {done ? `応援済み（${points}）` : `応援する（${points}）`}
    </button>
  );
}
