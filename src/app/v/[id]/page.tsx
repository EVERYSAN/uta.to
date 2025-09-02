// src/app/v/[id]/page.tsx
import { PrismaClient } from '@prisma/client';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ClientBits from './ClientBits';
import YouTubeLite from '@/components/YouTubeLite';

export const dynamic = 'force-dynamic'; // 常に最新を取得

const prisma = new PrismaClient();

/* ---------- helpers ---------- */
const nf = new Intl.NumberFormat('ja-JP');
const fmt = (n?: number | null) => (typeof n === 'number' ? nf.format(n) : '0');
const fmtDate = (dt?: string | Date | null) => {
  if (!dt) return '';
  const d = typeof dt === 'string' ? new Date(dt) : dt;
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
};
const secsToLabel = (s?: number | null) => {
  if (s == null) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
};

/** ★追加: URL/ID/shorts から 11桁のYouTube IDを抽出 */
function toYouTubeId(input?: string | null): string | null {
  if (!input) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input; // 既にID

  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);

    // youtu.be/VIDEOID
    if (host === 'youtu.be' && parts[0] && /^[\w-]{11}/.test(parts[0])) {
      return parts[0].substring(0, 11);
    }
    // youtube.com/watch?v=VIDEOID
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}/.test(v)) return v.substring(0, 11);
    // /embed/VIDEOID
    const i = parts.indexOf('embed');
    if (i >= 0 && parts[i + 1] && /^[\w-]{11}/.test(parts[i + 1])) {
      return parts[i + 1].substring(0, 11);
    }
    // /shorts/VIDEOID
    if (parts[0] === 'shorts' && parts[1] && /^[\w-]{11}/.test(parts[1])) {
      return parts[1].substring(0, 11);
    }
  } catch {
    // 生文字列から拾う
  }
  const m = input.match(/([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function TrendingBadge() {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-violet-600/20 text-violet-300 px-2 py-0.5 text-[11px]">
      <span>⬆</span>
      <span className="font-medium">急上昇</span>
      <span className="opacity-70">/ 24時間</span>
    </div>
  );
}

type Params = { params: { id: string } };

export default async function VideoDetailPage({ params }: Params) {
  const idParam = params.id;

  // 1) DBのid 2) 見つからなければ platformVideoId で検索
  const select = {
    id: true,
    platform: true,
    platformVideoId: true,
    title: true,
    url: true,
    thumbnailUrl: true,
    durationSec: true,
    publishedAt: true,
    channelTitle: true,
    views: true,
    likes: true,
  } as const;

  let v =
    (await prisma.video.findUnique({ where: { id: idParam }, select })) ??
    (await prisma.video.findFirst({
      where: { platformVideoId: idParam },
      select,
    }));

  if (!v) notFound();

  // 関連（同チャンネル優先→足りなければ直近公開で補完）
  let related = await prisma.video.findMany({
    where: {
      id: { not: v.id },
      platform: 'youtube',
      channelTitle: v.channelTitle ?? undefined,
    },
    orderBy: [{ publishedAt: 'desc' as const }],
    take: 12,
    select: {
      id: true,
      title: true,
      thumbnailUrl: true,
      durationSec: true,
      views: true,
      publishedAt: true,
    },
  });

  if (related.length < 8) {
    const more = await prisma.video.findMany({
      where: { id: { not: v.id }, platform: 'youtube' },
      orderBy: [{ publishedAt: 'desc' as const }],
      take: 12 - related.length,
      select: {
        id: true,
        title: true,
        thumbnailUrl: true,
        durationSec: true,
        views: true,
        publishedAt: true,
      },
    });
    related = [...related, ...more];
  }

  // ★追加: 正規化したIDを作る（platformVideoIdがURLでもOK）
  const idOrUrl = v.platformVideoId || v.url || '';
  const ytId = toYouTubeId(idOrUrl);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* 左：プレイヤー＆メタ */}
      <article className="lg:col-span-8 space-y-4">
        <div className="aspect-video rounded-2xl overflow-hidden bg-black">
          {v.platform === 'youtube' ? (
            ytId ? (
              <YouTubeLite id={ytId} title={v.title ?? 'video'} />
            ) : (
              // IDが取れない場合のフォールバック
              <div className="w-full h-full grid place-items-center bg-zinc-900 text-zinc-200">
                <a
                  href={v.url ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium"
                >
                  YouTubeで開く ↗
                </a>
              </div>
            )
          ) : (
            // YouTube以外のフォールバック（必要ならHLS/MP4）
            <iframe
              src={v.url ?? ''}
              title={v.title ?? 'video'}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          )}
        </div>

        <h1 className="text-xl md:text-2xl font-bold text-zinc-100">
          {v.title}
        </h1>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <TrendingBadge />
          <span className="text-zinc-400">公開: {fmtDate(v.publishedAt)}</span>
          <span className="text-zinc-400">👁 {fmt(v.views)}</span>
          <span className="text-zinc-400">❤️ {fmt(v.likes)}</span>

          {/* 右寄せ：お気に入り / 共有（クライアント） */}
          <span className="ml-auto" />
          <ClientBits videoId={v.id} />
        </div>

        <div className="text-zinc-300 text-sm">
          {v.channelTitle && (
            <div>
              チャンネル: <span className="font-medium">{v.channelTitle}</span>
            </div>
          )}
          {typeof v.durationSec === 'number' && (
            <div>長さ: {secsToLabel(v.durationSec)}</div>
          )}
        </div>

        <div className="pt-2">
          <Link
            href="https://docs.google.com/forms/d/e/1FAIpQLSc_report_form"
            target="_blank"
            className="text-xs text-zinc-400 underline"
          >
            通報・フィードバック
          </Link>
        </div>
      </article>

      {/* 右：関連 */}
      <aside className="lg:col-span-4">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">関連</h2>
        <div className="grid gap-3">
          {related.map((r) => (
            <Link
              key={r.id}
              href={`/v/${r.id}`}
              prefetch={false}
              className="flex gap-3 rounded-xl overflow-hidden bg-zinc-900 hover:bg-zinc-800 transition-colors"
            >
              <div className="relative w-40 aspect-video bg-zinc-800 shrink-0">
                {r.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.thumbnailUrl}
                    alt={r.title ?? ''}
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                {typeof r.durationSec === 'number' && (
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 text-white text-[10px] px-1">
                    {secsToLabel(r.durationSec)}
                  </span>
                )}
              </div>
              <div className="py-2 pr-3 flex-1">
                <div className="text-[13px] font-medium line-clamp-2 text-zinc-100">
                  {r.title}
                </div>
                <div className="mt-1 text-[11px] text-zinc-400 flex items-center gap-2">
                  <span>👁 {fmt(r.views)}</span>
                  <span>{fmtDate(r.publishedAt)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </aside>
    </main>
  );
}
