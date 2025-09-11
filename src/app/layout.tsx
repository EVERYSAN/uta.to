import './globals.css';
import type { Metadata } from 'next';
import Header from '@/components/Header';

export const metadata: Metadata = {
  metadataBase: new URL('https://uta-to.vercel.app'),
  title: { default: 'uta.to', template: '%s | uta.to' },
  description: '歌ってみたを横断検索 / 新着・人気・高評価でソート可能',
  openGraph: {
    title: 'uta.to',
    description: '歌ってみたを横断検索',
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
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://www.youtube-nocookie.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://s.ytimg.com" />
      </head>
      <body className="min-h-screen bg-white text-gray-900">
        <Header />
        <main className="mx-auto max-w-screen-xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
