import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";   // ★ 追加

export const dynamic = "force-dynamic";

// 秒 → m:ss
function fmtSec(sec?: number | null) {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: { q?: string; sort?: string };
}) {
  const q = (searchParams?.q ?? "").trim();
  const sort = searchParams?.sort ?? "new"; // new | old | len

  // ★ Prisma.QueryMode.insensitive を使用
  const where: Prisma.VideoWhereInput | undefined =
    q.length > 0
      ? {
          OR: [
            {
              title: {
                contains: q,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              description: {
                contains: q,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ],
        }
      : undefined;

  const orderBy: Prisma.VideoOrderByWithRelationInput[] =
    sort === "old"
      ? [{ publishedAt: "asc" }]
      : sort === "len"
      ? [{ durationSec: "desc" }]
      : [{ publishedAt: "desc" }];

  const items = await prisma.video.findMany({
    where,
    orderBy,
    take: 50, // 表示上限
    select: {
      id: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      publishedAt: true,
      durationSec: true,
    },
  });

  const total = await prisma.video.count({ where });

  return (
    <main style={{ maxWidth: 1100, margin: "24px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
        歌ってみた 検索
      </h1>

      <form action="/" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="キーワード"
          style={{
            flex: 1,
            padding: "10px 12px",
            border: "1px solid #ddd",
            borderRadius: 6,
          }}
        />
        <select
          name="sort"
          defaultValue={sort}
          style={{
            padding: "10px 12px",
            border: "1px solid #ddd",
            borderRadius: 6,
          }}
        >
          <option value="new">新着順</option>
          <option value="old">古い順</option>
          <option value="len">長い順</option>
        </select>
        <button
          type="submit"
          style={{
            padding: "10px 16px",
            background: "#000",
            color: "#fff",
            borderRadius: 6,
          }}
        >
          検索
        </button>
      </form>

      <div style={{ marginBottom: 12, color: "#555" }}>
        {total > 0
          ? `ヒット ${total} 件（表示 ${items.length} 件）`
          : "データがありません。「今すぐ収集」を押すか、しばらくお待ちください。"}
      </div>

      {/* 手動収集（必要なら残す） */}
      <div style={{ marginBottom: 20 }}>
        <a
          href="/api/ingest/youtube?hours=24&pages=2"
          style={{
            padding: "10px 14px",
            background: "#000",
            color: "#fff",
            borderRadius: 6,
            textDecoration: "none",
          }}
        >
          今すぐ収集
        </a>
      </div>

      {/* 一覧 */}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
          gap: 16,
        }}
      >
        {items.map((v) => (
          <li
            key={v.id}
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <a
              href={v.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              {v.thumbnailUrl ? (
                <img
                  src={v.thumbnailUrl}
                  alt=""
                  style={{
                    width: "100%",
                    aspectRatio: "16 / 9",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "16 / 9",
                    background: "#f3f3f3",
                  }}
                />
              )}
              <div style={{ padding: 12 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "#666",
                    marginBottom: 6,
                  }}
                >
                  {new Date(v.publishedAt).toLocaleString("ja-JP", {
                    timeZone: "Asia/Tokyo",
                  })}
                  {v.durationSec != null && ` ・ ${fmtSec(v.durationSec)}`}
                </div>
                <div style={{ fontWeight: 600, lineHeight: 1.35 }}>
                  {v.title}
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
