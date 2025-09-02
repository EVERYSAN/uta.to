import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { fetchDetails, type RawVideo } from "@/lib/youtube";

const prisma = new PrismaClient();

/**
 * /api/refresh/youtube?ids=aaa,bbb,ccc
 * - YouTube の詳細を取り直して Video テーブルを upsert
 * - 既存レコードは title/thumbnail/url/duration/channelTitle/views/likes/publishedAt を更新
 * - 作成時は必須の title / url を必ず補完して渡す
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get("ids");

    if (!idsParam) {
      return NextResponse.json({ ok: false, error: "required: ids" }, { status: 400 });
    }

    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "required: ids" }, { status: 400 });
    }

    // 取得
    const videos: RawVideo[] = await fetchDetails(ids);

    let upserts = 0;
    let skippedNoId = 0;
    let skippedNoPub = 0;

    for (const it of videos) {
      // RawVideo には platformVideoId は無い。contentDetails.videoId または id から導出する
      const platform = "youtube";
      const platformVideoId = it.contentDetails?.videoId ?? it.id ?? "";

      if (!platformVideoId) {
        skippedNoId++;
        continue;
      }

      // 文字列は素のまま、日時は Date に正規化
      const publishedAt = it.publishedAt ? new Date(it.publishedAt) : undefined;

      // update 用は「あるものだけ」キー追加（undefined を渡さない）
      const updateData: Record<string, any> = {};
      if (it.title != null) updateData.title = it.title;
      if (it.thumbnailUrl != null) updateData.thumbnailUrl = it.thumbnailUrl;
      if (it.url != null) updateData.url = it.url;
      if (it.durationSec != null) updateData.durationSec = it.durationSec;
      if (it.channelTitle != null) updateData.channelTitle = it.channelTitle;
      if (it.views != null) updateData.views = it.views;
      if (it.likes != null) updateData.likes = it.likes;
      if (publishedAt) updateData.publishedAt = publishedAt;

      // create 用は必須フィールドを必ず与える（title / url）
      // どちらか欠ける場合は安全なデフォルトを補完
      const safeTitle = it.title ?? `video ${platformVideoId}`;
      const safeUrl =
        it.url ?? `https://www.youtube.com/watch?v=${platformVideoId}`;

      const createData: Record<string, any> = {
        platform,
        platformVideoId,
        title: safeTitle,
        url: safeUrl,
      };
      if (it.thumbnailUrl != null) createData.thumbnailUrl = it.thumbnailUrl;
      if (it.durationSec != null) createData.durationSec = it.durationSec;
      if (it.channelTitle != null) createData.channelTitle = it.channelTitle;
      if (it.views != null) createData.views = it.views;
      if (it.likes != null) createData.likes = it.likes;
      if (publishedAt) createData.publishedAt = publishedAt;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } },
        create: createData, // ← create にはプリミティブ確定値のみ
        update: updateData, // ← update は存在するキーだけ
      });

      upserts++;
    }

    return NextResponse.json({
      ok: true,
      requested: ids.length,
      fetched: videos.length,
      upserts,
      skippedNoId,
      skippedNoPub, // いまは未使用だが将来用
    });
  } catch (err: any) {
    const message =
      (err && (err.message || err.toString())) || "unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
