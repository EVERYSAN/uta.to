// src/app/api/videos/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const sort = searchParams.get("sort") ?? "new"; // new | old | len
    const take = Math.min(Number(searchParams.get("take") ?? 50), 100);

    // ← 型を Prisma.VideoWhereInput に、mode は Prisma.QueryMode.insensitive
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

    const total = await prisma.video.count({ where });

    return NextResponse.json({ ok: true, total, items });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
