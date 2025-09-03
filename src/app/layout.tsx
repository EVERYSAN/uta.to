// src/app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import HeaderActions from "@/components/HeaderActions";
import ActionDock from "@/components/ActionDock";

export const metadata: Metadata = {
  metadataBase: new URL('https://uta-to.vercel.app'),
  title: { default: 'uta.to', template: '%s | uta.to' },
  description: '歌ってみたのランキングサイト / 新着・人気・高評価でソート可能',
  openGraph: {
    title: 'uta.to',
    description: '歌ってみたのランキングサイト',
    url: 'https://uta-to.vercel.app',
    siteName: 'uta.to',
    images: ['/og.png'],
    locale: 'ja_JP',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/* YouTube を速くするための事前接続 */}
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://www.youtube-nocookie.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://s.ytimg.com" />
      </head>
      <body className="min-h-screen bg-white text-gray-900">
        <header className="border-b">
          <nav className="mx-auto max-w-screen-xl px-4 py-3 flex gap-4 text-sm">
            <Link href="/" className="underline-offset-4 hover:underline">
              ホーム
            </Link>
            <Link href="/trending" className="underline-offset-4 hover:underline">
              急上昇
            </Link>
          </nav>
        </header>

        <main className="mx-auto max-w-screen-xl px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}

