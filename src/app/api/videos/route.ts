// src/app/api/videos/route.ts
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const sort = url.searchParams.get("sort") || "new";
  const take = Math.min(100, Number(url.searchParams.get("take") || "50"));

  const where =
    q.length > 0
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};

  const orderBy =
    sort === "old"
      ? [{ publishedAt: "asc" as const }]
      : sort === "len"
      ? [{ durationSec: "desc" as const }]
      : [{ publishedAt: "desc" as const }];

  const items = await prisma.video.findMany({
    where,
    orderBy,
    take,
    select: {
      id: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      publishedAt: true,
      durationSec: true,
    },
  });
  const count = await prisma.video.count({ where });
  return new Response(JSON.stringify({ count, items }), {
    headers: { "content-type": "application/json" },
  });
}
