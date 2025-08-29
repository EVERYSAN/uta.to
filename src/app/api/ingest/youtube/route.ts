import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { videoId, snippet, contentDetails, statistics } = await req.json();

    const video = await prisma.video.upsert({
      where: {
        platform_platformVideoId: {
          platform: "youtube",
          platformVideoId: videoId,
        },
      },
      create: {
        platform: "youtube",
        platformVideoId: videoId,
        title: snippet.title || "",
        description: snippet.description || "",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: snippet.thumbnails?.high?.url || null,
        publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : new Date(),
        durationSec: contentDetails?.durationSec || null,
        channelTitle: snippet.channelTitle || "",
        views: statistics?.viewCount ? parseInt(statistics.viewCount, 10) : 0,   // 👈 views追加
        likes: statistics?.likeCount ? parseInt(statistics.likeCount, 10) : 0,   // 👈 likes追加
      },
      update: {
        title: snippet.title || "",
        description: snippet.description || "",
        thumbnailUrl: snippet.thumbnails?.high?.url || null,
        publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : new Date(),
        durationSec: contentDetails?.durationSec || null,
        channelTitle: snippet.channelTitle || "",
        views: statistics?.viewCount ? parseInt(statistics.viewCount, 10) : 0,   // 👈 更新
        likes: statistics?.likeCount ? parseInt(statistics.likeCount, 10) : 0,   // 👈 更新
      },
    });

    return NextResponse.json({ success: true, video });
  } catch (e) {
    console.error("Ingest error:", e);
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
