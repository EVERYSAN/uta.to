import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const prisma = new PrismaClient();

function fromHours(h: number) {
  return new Date(Date.now() - h * 3600_000);
}

async function count(where: any) {
  return prisma.video.count({ where });
}

export async function GET() {
  const r24 = fromHours(24);
  const r7d = fromHours(24 * 7);
  const r30 = fromHours(24 * 30);

  const base = (from: Date) => ({ publishedAt: { gte: from } });

  const shortsOnly = {
    OR: [{ url: { contains: "/shorts/" } }, { durationSec: { lte: 60 } }],
  };
  const longsOnly = {
    AND: [
      { url: { not: { contains: "/shorts/" } } },
      { OR: [{ durationSec: { gte: 61 } }, { durationSec: { equals: null } }] },
    ],
  };

  const data = {
    now: new Date().toISOString(),
    ranges: {
      "24h": {
        all: await count(base(r24)),
        shorts: await count({ ...base(r24), ...shortsOnly }),
        longs: await count({ ...base(r24), ...longsOnly }),
      },
      "7d": {
        all: await count(base(r7d)),
        shorts: await count({ ...base(r7d), ...shortsOnly }),
        longs: await count({ ...base(r7d), ...longsOnly }),
      },
      "30d": {
        all: await count(base(r30)),
        shorts: await count({ ...base(r30), ...shortsOnly }),
        longs: await count({ ...base(r30), ...longsOnly }),
      },
    },
    sampleLatest5: await prisma.video.findMany({
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        url: true,
        durationSec: true,
        publishedAt: true,
      },
    }),
  };

  return NextResponse.json(data);
}
