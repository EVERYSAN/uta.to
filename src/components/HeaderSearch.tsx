'use client';

import { useEffect, useRef } from 'react';

type Range = '1d' | '7d' | '30d';
type Sort = 'hot' | 'new' | 'support';
type Shorts = 'all' | 'exclude' | 'only';

export default function HeaderSearch({
  defaultRange = '7d',
  defaultShorts = 'all',
  defaultSort = 'hot',
}: {
  defaultRange?: Range;
  defaultShorts?: Shorts;
  defaultSort?: Sort;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // ニコニコ風ショートカット: "/" でフォーカス
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
    <form role="search" action="/search" method="GET" className="w-full">
      <input type="hidden" name="range" value={defaultRange} />
      <input type="hidden" name="shorts" value={defaultShorts} />
      <input type="hidden" name="sort" value={defaultSort} />
      <label htmlFor="global-search" className="sr-only">動画を検索</label>
      <div className="relative">
        <input
          id="global-search"
          ref={inputRef}
          name="q"
          placeholder="動画を検索（/ でフォーカス）"
          autoComplete="off"
          className="w-full rounded-full bg-white px-5 py-3 pr-14 text-sm outline-none
                     ring-1 ring-gray-300 focus:ring-2 focus:ring-purple-600 transition"
        />
        <button
          type="submit"
          className="absolute right-1.5 top-1.5 h-9 px-4 rounded-full text-sm
                     bg-purple-600 text-white hover:opacity-90 transition"
          aria-label="検索"
        >
          検索
        </button>
      </div>
    </form>
  );
}
