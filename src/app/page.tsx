import Link from "next/link";

export const dynamic = "force-dynamic";

async function fetchVideos(q: string, sort: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (sort) params.set("sort", sort);
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/videos?` + params.toString(),
    { cache: "no-store" }
  );
  if (!res.ok) return { items: [] as any[] };
  return res.json();
}

function timeJP(d: string | Date) {
  try { return new Date(d).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }); }
  catch { return ""; }
}

export default async function Home({
  searchParams,
}: {
  searchParams?: { q?: string; sort?: string };
}) {
  const q = searchParams?.q ?? "";
  const sort = searchParams?.sort ?? "new";
  const { items } = await fetchVideos(q, sort);

  return (
    <main style={{ maxWidth: 1100, margin: "20px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>歌ってみた 検索</h1>

      <form style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="キーワード（曲名 / 作者 / チャンネル）"
          style={{ flex: 1, padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        />
        <select name="sort" defaultValue={sort} style={{ padding: 10, borderRadius: 8 }}>
          <option value="new">新着順</option>
          <option value="views">再生数</option>
          <option value="likes">高評価</option>
        </select>
        <button type="submit" style={{ padding: "10px 14px", borderRadius: 8, background: "black", color: "white" }}>
          検索
        </button>
      </form>

      {items.length === 0 && <p>データがありません。まず <code>/api/ingest/youtube</code> を実行してください。</p>}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 12
      }}>
        {items.map((v: any) => (
          <Link key={v.id} href={`/video/${v.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <article style={{ border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }}>
              {v.thumbnailUrl && (
                <img src={v.thumbnailUrl} alt={v.title} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover" }} />
              )}
              <div style={{ padding: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, lineHeight: 1.4 }}>
                  {v.title || "No title"}
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  {v.creator?.name ?? "Unknown"}・{timeJP(v.publishedAt)}
                </div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  {v.views ? `${v.views.toLocaleString()} 回視聴` : ""} {v.likes ? ` / ${v.likes.toLocaleString()} いいね` : ""}
                </div>
              </div>
            </article>
          </Link>
        ))}
      </div>
    </main>
  );
}
