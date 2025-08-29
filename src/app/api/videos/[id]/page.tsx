import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function VideoPage({ params }: { params: { id: string } }) {
  const video = await prisma.video.findUnique({
    where: { id: params.id },
    include: { creator: true },
  });

  if (!video) {
    return <main style={{ padding: 20 }}>動画が見つかりませんでした。</main>;
  }

  const isYouTube = video.platform === "youtube";
  const ytId = isYouTube ? (video.platformVideoId as string) : null;

  return (
    <main style={{ maxWidth: 1100, margin: "20px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>{video.title}</h1>
      <div style={{ color: "#666", marginBottom: 12 }}>
        {video.creator?.name ?? "Unknown"} / {new Date(video.publishedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
      </div>

      {isYouTube && ytId ? (
        <div style={{ width: "100%", aspectRatio: "16/9", marginBottom: 16 }}>
          <iframe
            src={`https://www.youtube.com/embed/${ytId}`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ width: "100%", height: "100%", border: "none", borderRadius: 10 }}
          />
        </div>
      ) : (
        <a href={video.url} target="_blank" rel="noreferrer">動画を開く</a>
      )}

      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{video.description ?? ""}</p>
    </main>
  );
}
