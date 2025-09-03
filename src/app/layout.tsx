// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import HeaderActions from "@/components/HeaderActions"; // 右上：保存/続きから見る（PC表示）
import ActionDock from "@/components/ActionDock";       // 画面下固定：保存/続きから見る（SP表示）

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
        {/* ヘッダー（PCは右上に保存/続きから） */}
        <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <nav className="mx-auto max-w-screen-xl px-4 py-3 flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-4">
              <Link href="/" className="underline-offset-4 hover:underline">ホーム</Link>
              <Link href="/trending" className="underline-offset-4 hover:underline">急上昇</Link>
              <Link href="/saved" className="underline-offset-4 hover:underline hidden sm:inline">
                保存
              </Link>
            </div>
            {/* PC表示：右上の操作（続きから/保存） */}
            <div className="hidden md:flex">
              <HeaderActions />
            </div>
          </nav>
        </header>

        {/* ページ本体 */}
        <main className="mx-auto max-w-screen-xl px-4 py-6">{children}</main>

        {/* モバイル表示：下部固定の操作ドック（続きから/保存） */}
        <div className="md:hidden">
          <ActionDock />
        </div>
      </body>
    </html>
  );
}
