'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

type Props = {
  defaultRange?: '1d' | '7d' | '30d';
  defaultShorts?: 'all' | 'exclude' | 'only';
  defaultSort?: 'hot' | 'new' | 'support';
};

export default function HeaderSearch({
  defaultRange = '7d',
  defaultShorts = 'all',
  defaultSort = 'hot',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sp = useSearchParams();
  const qFromURL = sp.get('q') ?? ''; // /search から戻ってきた時に引き継ぐ

  // ニコニコ風ショートカット: "/" で検索欄にフォーカス
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      role="search"
      action="/search"
      method="GET"
      className="w-full"
    >
      {/* 既定の検索条件は hidden で付与（/api/search が同じ名前で受け取る） */}
      <input type="hidden" name="range" value={defaultRange} />
      <input type="hidden" name="shorts" value={defaultShorts} />
      <input type="hidden" name="sort" value={defaultSort} />

      <label htmlFor="global-search" className="sr-only">動画を検索</label>
      <div className="relative group">
        <input
          id="global-search"
          ref={inputRef}
          name="q"
          defaultValue={qFromURL}
          placeholder="動画を検索（/ でフォーカス）"
          autoComplete="off"
          className="w-full rounded-full bg-background px-5 py-3 pr-12 text-sm outline-none ring-1 ring-border
                     focus:ring-2 focus:ring-primary shadow-sm transition"
        />
        <button
          type="submit"
          className="absolute right-1 top-1.5 h-9 px-4 rounded-full text-sm
                     bg-primary text-primary-foreground hover:opacity-90 transition"
          aria-label="検索"
        >
          検索
        </button>
      </div>
    </form>
  );
}
