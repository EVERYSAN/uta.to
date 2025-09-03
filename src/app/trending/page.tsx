// src/app/trending/page.tsx
import React from "react";
import { headers } from "next/headers";

type Range = "24h" | "7d" | "30d";
type Shorts = "any" | "only" | "exclude" | "long";
type Sort = "trending" | "support" | "latest" | "popular";

// 実行環境に応じて絶対URLを作る（VercelでもローカルでもOK）
function getBaseUrl() {
  // 優先: 環境変数（例: https://uta.to）
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  if (env) {
    return env.startsWith("http") ? env : `https://${env}`;
  }
  // 次: リクエストヘッダ
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto =
    h.get("x-forwarded-proto") ??
    (host && host.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

// クエリを正しく組み立て
function buildQuery(p: Record<string, string | undefined>) {
  const qp = new URLSearchParams();
  const range: Range = (p.range as Range) ?? "24h";
  const shorts: Shorts = (p.shorts as Shorts) ?? "any";
  const sort: Sort = (p.sort as Sort) ?? "trending";
  const page = Number(p.page ?? "1") || 1;
  const take = Number(p.take ?? "24") || 24;

  qp.set("range", range);
  qp.set("shorts", shorts);
  qp.set("sort", sort);
  qp.set("page", String(page));
  qp.set("take", String(take));
  return qp;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // searchParams を文字列に正規化（配列が来たら先頭を使う）
  const sp: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  );

  const qp = buildQuery(sp);
  const url = `${getBaseUrl()}/api/videos?${qp.toString()}`;

  const res = await fetch(url, { cache: "no-store" }); // キャッシュせず最新を取得
  if (!res.ok) {
    return (
      <main className="mx-auto max-w-[1200px] px-4 py-6">
        <div className="text-center text-sm text-zinc-400 mt-16">
          データの取得に失敗しました
        </div>
      </main>
    );
  }
  const data = (await res.json()) as {
    ok: boolean;
    meta: any;
    items: any[];
  };

  // ここから表示（従来UIのカード部分だけ置いています）
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6">
      {/* フィルタのボタン/リンクは従来通り ?range=24h などを付けるだけ */}
      {data.items.length === 0 ? (
        <div className="text-center text-sm text-zinc-400 mt-16">
          該当する動画がありません
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((v) => (
            <article key={v.id} className="rounded-xl bg-zinc-900/40 p-3">
              <img
                src={v.thumbnailUrl}
                alt=""
                className="w-full aspect-video rounded-lg object-cover"
              />
              <div className="mt-2 text-sm">
                <div className="font-medium line-clamp-2">{v.title}</div>
                <div className="text-zinc-400 text-xs mt-1">
                  {v.channelTitle} ・ {v.durationSec ?? "-"}s ・{" "}
                  {v.publishedAt ? new Date(v.publishedAt).toLocaleString() : "-"}
                </div>
                <div className="text-zinc-400 text-xs mt-1">
                  👀 {v.views ?? 0}　❤️ {v.likes ?? 0}　🔥pt {v.support ?? 0}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
