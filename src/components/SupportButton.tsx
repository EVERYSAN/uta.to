'use client';

import { useState } from 'react';

type Props = {
  videoId: string;
  initialPoints: number;
};

export default function SupportButton({ videoId, initialPoints }: Props) {
  const [points, setPoints] = useState(initialPoints);
  const [busy, setBusy] = useState(false);
  const [duplicated, setDuplicated] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  async function onClick() {
    if (busy || duplicated) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/support', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);

      if (typeof j.points === 'number') setPoints(j.points);
      if (j.duplicated) {
        setDuplicated(true);
      } else {
        // 小さな祝砲🎉
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 900);
        // その日の1回目を押した直後は“済み”に
        setDuplicated(true);
      }
      // ✅ 応援成功時（setDuplicated(true) の後あたり）に追加
    try {
      localStorage.setItem("support:lastUpdated", String(Date.now()));
      // BroadcastChannel が使える環境なら同時に通知（タブ間でも動く）
      // eslint-disable-next-line no-undef
      if (typeof BroadcastChannel !== "undefined") {
        const ch = new BroadcastChannel("support");
        ch.postMessage({ type: "updated" });
        ch.close();
      }
    } catch {}

    } catch (e: any) {
      setErr(e?.message || 'internal_error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <button
          onClick={onClick}
          disabled={busy || duplicated}
          className={[
            'group relative overflow-hidden rounded-full px-5 py-2.5',
            'text-white font-semibold shadow-lg transition',
            'bg-gradient-to-r from-fuchsia-500 to-violet-500',
            'hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:scale-[.98]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          ].join(' ')}
          aria-live="polite"
        >
          {/* きらっと演出 */}
          <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition">
            <span className="absolute -left-24 top-0 h-full w-24 rotate-12 bg-white/15 blur-md will-change-transform animate-[shine_1.8s_ease-in-out_infinite]" />
          </span>

          <span className="inline-flex items-center gap-2">
            <HeartIcon className="h-5 w-5 drop-shadow" filled={celebrate || duplicated} />
            <span className="whitespace-nowrap">
              {duplicated ? '今日の応援 済み' : busy ? '送信中…' : '応援する！ +1'}
            </span>
          </span>
        </button>

        {/* ふわっとハート */}
        {celebrate && (
          <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2">
            <span className="inline-block animate-[floatUp_900ms_ease-out_forwards]">
              <HeartIcon className="h-6 w-6 text-pink-400/90" filled />
            </span>
          </span>
        )}
      </div>

      {/* カウントのチップ */}
      <span
        className={[
          'inline-flex items-center gap-1 rounded-full',
          'border border-zinc-700/60 bg-zinc-900/60',
          'px-3 py-1 text-xs text-zinc-200',
        ].join(' ')}
        title="累計応援ポイント"
      >
        <HeartIcon className="h-4 w-4 text-pink-400" filled />
        <span className="tabular-nums">{points}</span>
        <span className="opacity-70">応援</span>
      </span>

      {err && <span className="text-xs text-red-400">( {err} )</span>}

      {/* アニメーション定義（Tailwind設定をいじらず使えるようにローカル定義） */}
      <style jsx>{`
        @keyframes floatUp {
          0% {
            transform: translate(-50%, 8px) scale(0.9);
            opacity: 0;
          }
          20% {
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -36px) scale(1);
            opacity: 0;
          }
        }
        @keyframes shine {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(220%);
          }
        }
      `}</style>
    </div>
  );
}

function HeartIcon({
  className,
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  return filled ? (
    <svg viewBox="0 0 24 24" className={className ?? ''} fill="currentColor" aria-hidden="true">
      <path d="M12.1 21.35c-.1.06-.22.06-.32 0C7.14 18.24 4 15.64 2.28 12.79 1.3 11.1 1 9.19 2.05 7.6 3.91 4.81 7.66 4.38 10 6.6l.03.03.03-.03c2.34-2.22 6.09-1.79 7.95.99 1.05 1.59.75 3.5-.23 5.19-1.72 2.85-4.86 5.45-9.68 8.57z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className={className ?? ''} fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
