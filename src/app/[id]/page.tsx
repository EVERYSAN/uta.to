// src/app/v/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma"; // いつもの prisma クライアント

// 5分に1回だけ再生成（視聴回数の更新と相性◎）
export const revalidate = 300;

// 動画IDごとのメタデータ
export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const v = await prisma.video.findUnique({
    where: { id: params.id },
    select: { title: true, platformVideoId: true, channelTitle: true, description: true, publishedAt: true },
  });
  if (!v) return {};
  const ytThumb = v.platformVideoId
    ? `https://i.ytimg.com/vi/${v.platformVideoId}/hqdefault.jpg`
    : undefined;

  return {
    title: v.title ?? "うたみた",
    description: v.description ?? undefined,
    openGraph: {
      title: v.title ?? "うたみた",
      description: v.description ?? undefined,
      images: ytThumb ? [{ url: ytThumb }] : undefined,
      type: "video.other",
    },
  };
}

export default async function VideoDetailPage({
  params,
}: { params: { id: string } }) {
  const id = params.id;

  // 単体動画
  const video = await prisma.video.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      platform: true,
      platformVideoId: true,
      description: true,
      channelTitle: true,
      publishedAt: true,
      views: true,
      likes: true,
      durationSec: true,
    },
  });
  if (!video) notFound();

  // 関連：同一チャンネル優先 + 直近30日
  const related = await prisma.video.findMany({
    where: {
      platform: "youtube",
      id: { not: id },
      AND: [
        { publishedAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) } },
        video.channelTitle ? { channelTitle: video.channelTitle } : {},
      ],
    },
    orderBy: [{ views: "desc" as const }, { publishedAt: "desc" as const }, { id: "asc" as const }],
    take: 12,
    select: {
      id: true,
      title: true,
      platformVideoId: true,
      publishedAt: true,
      views: true,
    },
  });

  // 応援指数（シンプル版）
  const views = video.views ?? 0;
  const likes = video.likes ?? 0;
  const hours = Math.max(1, (Date.now() - new Date(video.publishedAt).getTime()) / 3_600_000);
  const velocity = (views + likes * 5) / hours;               // 時間当たり勢い
  const supportPct = Math.max(0, Math.min(100, Math.round((velocity / (velocity + 300)) * 100)));

  const ytId = video.platformVideoId ?? "";
  const embedSrc =
    video.platform === "youtube" && ytId
      ? `https://www.youtube.com/embed/${ytId}?rel=0`
      : undefined;
  const thumb =
    ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : "/og.png";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* パンくず */}
      <div className="mb-3 text-sm text-zinc-400">
        <Link href="/" className="hover:underline">ホーム</Link>
        <span className="mx-2">/</span>
        <Link href="/trending" className="hover:underline">急上昇</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* 左：プレイヤー＋本文 */}
        <section>
          {/* プレイヤー */}
          <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
            {embedSrc ? (
              <iframe
                className="h-full w-full"
                src={embedSrc}
                title={video.title ?? "video"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            ) : (
              <Image
                src={thumb}
                alt={video.title ?? ""}
                width={1280}
                height={720}
                className="h-full w-full object-cover"
              />
            )}
          </div>

          {/* タイトル */}
          <h1 className="mt-4 text-xl font-semibold text-white leading-7">
            {video.title}
          </h1>

          {/* メタ情報 */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
            <span className="rounded-full bg-zinc-800/60 px-3 py-1">
              {formatDate(video.publishedAt)} 公開
            </span>
            {video.channelTitle && (
              <span className="rounded-full bg-zinc-800/60 px-3 py-1">
                {video.channelTitle}
              </span>
            )}
            <span className="rounded-full bg-zinc-800/60 px-3 py-1">
              👁‍🗨 {formatNum(views)}
            </span>
            <span className="rounded-full bg-zinc-800/60 px-3 py-1">
              ❤️ {formatNum(likes)}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <FavButton videoId={video.id} />
              <ShareButton />
              <Link
                href={`/report?videoId=${video.id}`}
                className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                通報
              </Link>
            </div>
          </div>

          {/* 説明文 */}
          {video.description && (
            <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-zinc-900/60 p-4 text-sm leading-6 text-zinc-300">
              {video.description}
            </p>
          )}
        </section>

        {/* 右：応援/広告/関連 */}
        <aside className="space-y-6">
          {/* 応援したくなる独自表示 */}
          <div className="rounded-2xl bg-zinc-900/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">応援指数</h2>
              <span className="text-xs text-zinc-400">（直近の勢い）</span>
            </div>
            <div className="mt-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${supportPct}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-zinc-400">
                速度: {(velocity).toFixed(1)} /h　|　スコア: {supportPct}%
              </div>
              <div className="mt-3 text-sm text-zinc-300">
                {supportPct >= 70
                  ? "いま大きく伸びています。いいねやシェアで後押ししよう！"
                  : supportPct >= 40
                  ? "これから伸びるかも。コメントや高評価で応援しよう！"
                  : "まだ見つかっていない動画。あなたの一票が力になります。"}
              </div>
            </div>
          </div>

          {/* 広告（将来） */}
          <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
            広告枠（将来: 詳細の右側のみ）
          </div>

          {/* 関連 */}
          <div className="space-y-3">
            <h3 className="px-1 text-sm font-semibold text-white">関連動画</h3>
            {related.length === 0 && (
              <p className="px-1 text-sm text-zinc-400">関連は見つかりませんでした</p>
            )}
            <ul className="space-y-3">
              {related.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/v/${r.id}`}
                    className="flex gap-3 rounded-xl p-2 hover:bg-zinc-900/60"
                  >
                    <div className="relative h-16 w-28 overflow-hidden rounded-lg bg-black">
                      <Image
                        src={`https://i.ytimg.com/vi/${r.platformVideoId}/mqdefault.jpg`}
                        alt={r.title ?? ""}
                        fill
                        sizes="112px"
                        className="object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm text-zinc-100">{r.title}</p>
                      <div className="mt-1 text-xs text-zinc-400">
                        {formatDate(r.publishedAt)}・👁‍🗨 {formatNum(r.views ?? 0)}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------- client bits (お気に入り/共有) ------------------------ */
"use client";
import { useEffect, useState } from "react";

function FavButton({ videoId }: { videoId: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const raw = localStorage.getItem("favVideos");
    if (!raw) return;
    try {
      const set = new Set<string>(JSON.parse(raw));
      setOn(set.has(videoId));
    } catch {}
  }, [videoId]);

  const toggle = () => {
    const raw = localStorage.getItem("favVideos");
    const set = new Set<string>(raw ? JSON.parse(raw) as string[] : []);
    if (set.has(videoId)) set.delete(videoId);
    else set.add(videoId);
    localStorage.setItem("favVideos", JSON.stringify([...set]));
    setOn(!on);
  };
  return (
    <button
      onClick={toggle}
      className={`rounded-lg px-3 py-1.5 text-sm border ${
        on
          ? "border-violet-500 bg-violet-500/10 text-violet-300"
          : "border-zinc-800 text-zinc-300 hover:bg-zinc-800"
      }`}
      title="お気に入り"
    >
      {on ? "★ お気に入り" : "☆ お気に入り"}
    </button>
  );
}

function ShareButton() {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {}
  };
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
      title="リンクをコピー"
    >
      {done ? "コピーしました" : "共有"}
    </button>
  );
}

/* --------------------------------- utils ---------------------------------- */
function formatNum(n: number) {
  return new Intl.NumberFormat("ja-JP").format(n);
}
function formatDate(d: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(d));
}
