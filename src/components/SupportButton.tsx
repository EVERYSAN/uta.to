'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  videoId: string;
  /** 画面初期表示用のポイント（SSRで渡す） */
  initialPoints?: number;
};

export default function SupportButton({ videoId, initialPoints = 0 }: Props) {
  const [points, setPoints] = useState<number>(initialPoints);
  const [pending, startTransition] = useTransition();
  const [clicked, setClicked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function onClick() {
    setErr(null);
    if (pending) return;

    // 連打ガード：1回押したら数秒は非活性に
    setClicked(true);
    setTimeout(() => setClicked(false), 4000);

    startTransition(async () => {
      try {
        const res = await fetch('/api/support', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ videoId, amount: 1 }),
          cache: 'no-store',
        });

        const json = await res.json().catch(() => ({} as any));
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }

        // API は { ok:true, total:number } を返す想定
        if (typeof json.total === 'number') {
          setPoints(json.total);
        } else {
          // total が無いAPIでも一応+1に見せる
          setPoints((p) => p + 1);
        }

        // SSR の表示（トレンド一覧や右カラムなど）も更新
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? 'エラーが発生しました');
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={pending || clicked}
        className="rounded-lg bg-violet-500 hover:bg-violet-600 disabled:opacity-60 text-white px-3 py-1.5 text-sm font-medium"
        title="1回押すと+1ポイント（短時間の連打は無効）"
      >
        {pending ? '送信中…' : '応援する +1'}
      </button>
      <span className="text-sm text-zinc-300">応援 {points.toLocaleString()}</span>
      {err && <span className="text-xs text-rose-300">（{err}）</span>}
    </div>
  );
}
