import Link from 'next/link';
import { Suspense } from 'react';
import HeaderSearch from '@/components/HeaderSearch';
import HeaderActions from '@/components/HeaderActions';

export default function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-4 px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-bold">uta.to</Link>
          <nav className="hidden md:flex items-center gap-5 text-sm">
            <Link href="/">ホーム</Link>
            <Link href="/trending">急上昇</Link>
            <Link href="/search">検索</Link>
          </nav>
        </div>

        <div className="ml-auto flex w-full max-w-xl items-center gap-3">
          {/* ← これが重要：Suspense で包む */}
          <Suspense fallback={<div className="hidden md:block w-full h-10 rounded-full bg-gray-100" />}>
            <HeaderSearch defaultRange="7d" defaultShorts="all" defaultSort="hot" />
          </Suspense>
          <HeaderActions />
        </div>
      </div>
    </header>
  );
}
