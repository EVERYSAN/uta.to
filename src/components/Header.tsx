import Link from 'next/link';
import { Suspense } from 'react';
import HeaderSearch from '@/components/HeaderSearch';
import HeaderActions from '@/components/HeaderActions';

export default function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-4 px-4">
        {/* 左：ロゴ/ナビ */}
        <div className="flex items-center gap-4">
          <Link href="/" className="font-bold">uta.to</Link>
          <nav className="hidden md:flex items-center gap-5 text-sm">
            <Link href="/" className="hover:underline underline-offset-4">ホーム</Link>
            <Link href="/trending" className="hover:underline underline-offset-4">急上昇</Link>
            <Link href="/search" className="hover:underline underline-offset-4">検索</Link>
          </nav>
        </div>

        {/* 右：検索バー → ユーザーアクション */}
        <div className="ml-auto flex w-full max-w-xl items-center gap-3">
          <Suspense fallback={<div className="hidden md:block w-full h-10 rounded-full bg-gray-100" />}>
            <HeaderSearch defaultRange="7d" defaultShorts="all" defaultSort="hot" />
          </Suspense>
          <HeaderActions />
        </div>
      </div>
    </header>
  );
}
