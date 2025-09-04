'use client';
import { useState } from 'react';

export default function SupportButton({
  videoId,
  initialPoints,
}: { videoId: string; initialPoints: number }) {
  const [points, setPoints] = useState(initialPoints);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/support', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);
      if (typeof j.points === 'number') setPoints(j.points);
    } catch (e: any) {
      setErr(e?.message || 'internal_error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={busy}
        className="rounded bg-violet-500 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {busy ? '送信中…' : '応援する +1'}
      </button>
      <span className="text-zinc-400">応援 {points}</span>
      {err && <span className="text-red-400 text-xs">({err})</span>}
    </span>
  );
}
