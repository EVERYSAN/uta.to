// src/app/[id]/page.tsx
import { PrismaClient } from "@prisma/client";
import { notFound } from "next/navigation";
import Link from "next/link";
import ClientActions from "./ClientActions";

export const dynamic = "force-dynamic"; // キャッシュしない

const prisma = new PrismaClient();

/* ---------- 小ユーティリティ ---------- */
const nf = new Intl.NumberFormat("ja-JP");
const fmt = (n?: number | null) => (typeof n === "number" ? nf.format(n) : "0");
const fmtDate = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
};
const secsToLabel = (s?: number | null) => {
  if (s == null) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

function TrendingBadge({
  rank,
  range = "1d",
}: {
  rank?: number | null;
  range?: "1d" | "7d" | "30d";
}) {
  const label = rank ? `#${rank}` : "急上昇";
  const rangeText = range === "1d" ? "24時間" : range === "7d" ? "7日間" : "30日間";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-violet-600/20 text-violet-300 px-2 py-0.5 text-[11px]">
      <span>⬆</span><span className="font-medium">{label}</span>
      <span className="opacity-70">/ {rangeText}</span>
    </div>
  );
}

type Params = { params: { id: string } };

export default async function VideoDetailPage({ params }: Params) {
  const idParam = params.id;

  // まずは DB の id で検索、見つからなければ platformVideoId でも検索（安全策）
  let v =
    (await prisma.video.findUnique({
      where: { id: idParam },
      select: {
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
        trendingRank: true,
        trendingScore: true,
      },
    })) ??
    (await prisma.video.findFirst({
      where: { platformVideoId: idParam },
      select: {
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
        trendingRank: true,
        trendingScore: true,
      },
    }));

  if (!v) notFound();

  // 関連（同チャンネル優先 → 足りなければ直近急上昇で補完）
  let related = await prisma.video.findMany({
    where: {
      id: { not: v.id },
      platform: "youtube",
      channelTitle: v.channelTitle ?? undefined,
    },
    orderBy: [{ trendingRank: "asc" }, { publishedAt: "desc" }],
    take: 12,
    select: {
      id: true,
      title: true,
      thumbnailUrl: true,
      durationSec: true,
      views: true,
      publishedAt: true,
      trendingRank: true,
    },
  });

  if (related.length < 8) {
    const more = await prisma.video.findMany({
      where: {
        id: { not: v.id },
        platform: "youtube",
      },
      orderBy: [{ trendingRank: "asc" }, { publishedAt: "desc" }],
      take: 12 - related.length,
      select: {
        id: true,
        title: true,
        thumbnailUrl: true,
        durationSec: true,
        views: true,
        publishedAt: true,
        trendingRank: true,
      },
    });
    related = [...related, ...more];
  }

  const embedUrl =
    v.platform === "youtube"
      ? `https://www.youtube.com/embed/${v.platformVideoId}?rel=0`
      : v.url;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* 左：プレイヤー＆メタ */}
      <article className="lg:col-span-8 space-y-4">
        <div className="aspect-video rounded-2xl overflow-hidden bg-black">
          <iframe
            src={embedUrl}
            title={v.title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>

        <h1 className="text-xl md:text-2xl font-bold text-zinc-100">{v.title}</h1>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <TrendingBadge rank={v.trendingRank ?? null} />
          <span className="text-zinc-400">公開: {fmtDate(v.publishedAt)}</span>
          <span className="text-zinc-400">👁 {fmt(v.views)}</span>
          <span className="text-zinc-400">❤️ {fmt(v.likes)}</span>

          {/* 右寄せ：お気に入り / 共有（クライアント） */}
          <span className="ml-auto" />
          <ClientActions videoId={v.id} />
        </div>

        <div className="text-zinc-300 text-sm">
          {v.channelTitle && (
            <div>
              チャンネル: <span className="font-medium">{v.channelTitle}</span>
            </div>
          )}
          {typeof v.durationSec === "number" && (
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
              href={`/${r.id}`}
              prefetch={false}
              className="flex gap-3 rounded-xl overflow-hidden bg-zinc-900 hover:bg-zinc-800 transition-colors"
            >
              <div className="relative w-40 aspect-video bg-zinc-800 shrink-0">
                {r.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.thumbnailUrl}
                    alt={r.title}
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                {typeof r.durationSec === "number" && (
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
                  <TrendingBadge rank={r.trendingRank ?? null} />
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
