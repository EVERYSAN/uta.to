import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RangeKey = "24h" | "7d" | "30d";

function fromOf(range: string | null) {
  const now = new Date();
  switch ((range as RangeKey) ?? "7d") {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "7d":
    default:
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
}

function supportFromVideo(v: any) {
  // Video テーブルに集計カラムがある／ないの両方に耐える
  const hearts = Number(v?.hearts ?? v?.heart ?? v?.heartsCount ?? v?.likes ?? 0) || 0;
  const flames = Number(v?.flames ?? v?.flame ?? v?.flamesCount ?? 0) || 0;
  const supporters =
    Number(v?.supporters ?? v?.support ?? v?.supportCount ?? v?.cheers ?? 0) || 0;
  return hearts + 2 * flames + 3 * supporters;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const range = (searchParams.get("range") as RangeKey) ?? "7d";
  const sort = (searchParams.get("sort") ?? "support") as "support" | "recent";
  const longOnly =
    ["1", "true", "yes"].includes((searchParams.get("long") || "").toLowerCase()) ||
    ["long", "1"].includes((searchParams.get("type") || "").toLowerCase());
  const excludeShorts = (searchParams.get("shorts") || "").toLowerCase() === "exclude";

  const from = fromOf(range);

  const AND: any[] = [{ publishedAt: { gte: from } }];
  if (longOnly) AND.push({ durationSec: { gte: 61 } }); // 61秒からロング
  if (excludeShorts) AND.push({ NOT: { url: { contains: "/shorts/" } } });

  const videos = await prisma.video.findMany({
    where: { AND },
    select: {
      id: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      channelTitle: true,
      publishedAt: true,
      durationSec: true,
      // ↓ 集計カラムが存在すれば一緒に返る（無くても OK）
      hearts: true as any,
      flames: true as any,
      supporters: true as any,
      likes: true as any,
      support: true as any,
    },
    orderBy: sort === "recent" ? { publishedAt: "desc" } : { publishedAt: "desc" }, // 応援順は後でアプリ側で並べ替え
    take: 60,
  });

  const list = (videos as any[]).map((v) => ({
    ...v,
    support: supportFromVideo(v),
  }));

  if (sort === "support") list.sort((a, b) => b.support - a.support);

  return NextResponse.json({ ok: true, list });
}
