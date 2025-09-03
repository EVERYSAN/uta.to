// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  metadataBase: new URL("https://uta-to.vercel.app"),
  title: { default: "uta.to", template: "%s | uta.to" },
  description: "歌ってみたのランキングサイト / 新着・人気・高評価でソート可能",
  openGraph: {
    title: "uta.to",
    description: "歌ってみたのランキングサイト",
    url: "https://uta-to.vercel.app",
    siteName: "uta.to",
    images: ["/og.png"],
    locale: "ja_JP",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/* YouTube 高速化の事前接続 */}
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://www.youtube-nocookie.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://s.ytimg.com" />
      </head>
      <body className="min-h-screen bg-white text-gray-900">
        {/* PC: ヘッダー（ホーム / 保存 のみ） */}
        <header className="hidden md:block sticky top-0 z-40 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <nav className="mx-auto max-w-screen-xl px-4 py-3 flex items-center justify-between text-sm">
            <div className="flex items-center gap-5">
              <Link href="/" className="underline-offset-4 hover:underline">ホーム</Link>
              <Link href="/saved" className="underline-offset-4 hover:underline">保存</Link>
            </div>
          </nav>
        </header>

        {/* 本文。SPのフッターが被らないように下余白を確保 */}
        <main className="mx-auto max-w-screen-xl px-4 py-6 pb-24 md:pb-8">
          {children}
        </main>

        {/* SP: 下部固定フッター（ホーム / 保存 のみ） */}
        <nav
          className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto max-w-screen-xl px-6 py-2.5 grid grid-cols-2 gap-3 text-sm">
            <Link
              href="/"
              className="flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white py-2 active:opacity-90"
            >
              {/* home icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 3 2 12h3v8h6v-5h2v5h6v-8h3z" />
              </svg>
              <span>ホーム</span>
            </Link>
            <Link
              href="/saved"
              className="flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white py-2 active:opacity-90"
            >
              {/* bookmark icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M6 2h12a1 1 0 0 1 1 1v19l-7-4-7 4V3a1 1 0 0 1 1-1z" />
              </svg>
              <span>保存</span>
            </Link>
          </div>
        </nav>
      </body>
    </html>
  );
}
