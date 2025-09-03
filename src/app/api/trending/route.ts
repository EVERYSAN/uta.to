// src/app/api/trending/route.ts
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Period = '24h' | '7d' | '30d'
type Sort = 'trending' | 'support' | 'latest'

function sinceFrom(period: Period) {
  const hours =
    period === '7d' ? 7 * 24 :
    period === '30d' ? 30 * 24 : 24
  return new Date(Date.now() - hours * 3600_000)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const period = (searchParams.get('period') ||
                  searchParams.get('window') ||
                  '24h') as Period

  const sort = (searchParams.get('sort') || 'trending') as Sort

  // "1" | "true" | "yes" をオンとして扱う
  const longOnly =
    ['1', 'true', 'yes', 'on'].includes(
      (searchParams.get('long') || '').toLowerCase()
    )

  const take = Math.min(Math.max(Number(searchParams.get('take') || '60'), 1), 200)

  const since = sinceFrom(period)

  const where: Prisma.VideoWhereInput = {
    // 期間：公開日時で絞り込み（nullを弾かない）
    publishedAt: { gte: since },
  }

  if (longOnly) {
    // ロング動画：Shorts を除外（durationSec が未取得でも除外できる）
    where.NOT = [
      { url: { contains: '/shorts/' } },
      { title: { contains: '#shorts' } },
    ]
  }

  const rows = await prisma.video.findMany({
    where,
    take,
    orderBy: { publishedAt: 'desc' }, // 一旦新しい順で取得 → 後で並べ替え
    select: {
      id: true,
      platform: true,
      platformVideoId: true,
      title: true,
      url: true,
      thumbnailUrl: true,
      channelTitle: true,
      publishedAt: true,
      durationSec: true,
      // 応援の近似に使う
      likes: true,
      views: true,
    },
  })

  const nowMs = Date.now()

  // 急上昇スコア（以前の考え方の近似）：(likes+views) / (経過時間/24h)^0.35
  const items = rows.map(v => {
    const support = (v.likes ?? 0) + (v.views ?? 0)
    const pubMs = v.publishedAt ? new Date(v.publishedAt as any).getTime() : nowMs
    const hours = Math.max(1, (nowMs - pubMs) / 3600_000)
    let trendScore = support / Math.pow(hours / 24, 0.35)
    if (longOnly) trendScore *= 1.05 // ロング微ブースト（以前の挙動の名残）
    return { ...v, support, trendScore }
  })

  if (sort === 'support') {
    items.sort((a, b) => (b.support) - (a.support))
  } else if (sort === 'latest') {
    items.sort(
      (a, b) =>
        new Date(b.publishedAt ?? 0).getTime() -
        new Date(a.publishedAt ?? 0).getTime()
    )
  } else {
    // trending
    items.sort((a, b) => b.trendScore - a.trendScore)
  }

  return NextResponse.json({
    period,
    longOnly,
    count: items.length,
    items,
  })
}
