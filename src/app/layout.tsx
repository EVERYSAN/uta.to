// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";

export const metadata: Metadata = {
  title: "BUZZ UTA",
  description: "歌ってみた・急上昇まとめ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="bg-zinc-950 text-zinc-100">
      <body className="min-h-dvh">
        {/* ===== Desktop Header (md↑) ===== */}
        <header className="hidden md:block sticky top-0 z-40 bg-zinc-950/80 backdrop-blur border-b border-zinc-900">
          <div className="mx-auto max-w-screen-xl px-4 h-14 flex items-center justify-between">
            {/* ← ロゴをホームリンクに */}
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/buzz-uta.png"
                alt="BUZZ UTA"
                width={28}
                height={28}
                className="w-7 h-7 rounded-md"
                priority
              />
              <span className="sr-only">ホーム</span>
            </Link>

            {/* 右側ナビ（保存だけ） */}
            <nav className="flex items-center gap-6">
              <Link
                href="/saved"
                className="text-sm text-zinc-300 hover:text-white"
              >
                保存
              </Link>
            </nav>
          </div>
        </header>

        {/* ===== Main ===== */}
        <main className="pb-16 md:pb-0">{children}</main>

        {/* ===== Mobile Bottom Nav (～md) ===== */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
          <div className="mx-auto max-w-screen-sm grid grid-cols-2">
            <Link
              href="/"
              className="h-12 flex items-center justify-center gap-1 text-sm text-zinc-300 hover:text-white"
            >
              ホーム
            </Link>
            <Link
              href="/saved"
              className="h-12 flex items-center justify-center gap-1 text-sm text-zinc-300 hover:text-white"
            >
              保存
            </Link>
          </div>
        </nav>
      </body>
    </html>
  );
}
