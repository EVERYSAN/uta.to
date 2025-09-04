// Server Component
import { prisma } from "@/lib/prisma";
import {
  MANUAL_FEATURED_IDS,
  FEATURED_AUTO_DAYS,
  FEATURED_TOTAL,
} from "@/config/featured";
import HeroCarouselClient from "./HeroCarouselClient";

export default async function HeroCarousel() {
  // 手動ピック（並び順は指定順を維持）
  const manualVideosRaw = MANUAL_FEATURED_IDS.length
    ? await prisma.video.findMany({
        where: { platformVideoId: { in: MANUAL_FEATURED_IDS } },
        select: {
          id: true,
          platformVideoId: true,
          title: true,
          channelTitle: true,
          url: true,
          thumbnailUrl: true,
          supportPoints: true,
          views: true,
          publishedAt: true,
        },
      })
    : [];

  const manualVideos = MANUAL_FEATURED_IDS
    .map((vid) => manualVideosRaw.find((v) => v.platformVideoId === vid))
    .filter(Boolean) as typeof manualVideosRaw;

  const excludeIds = new Set(manualVideos.map((v) => v.id));
  const since = new Date(Date.now() - FEATURED_AUTO_DAYS * 24 * 60 * 60 * 1000);

  // 自動ピック（応援順）
  const autoVideos = await prisma.video.findMany({
    where: {
      id: { notIn: Array.from(excludeIds) },
      publishedAt: { gte: since },
    },
    orderBy: { supportPoints: "desc" },
    take: Math.max(0, FEATURED_TOTAL - manualVideos.length),
    select: {
      id: true,
      platformVideoId: true,
      title: true,
      channelTitle: true,
      url: true,
      thumbnailUrl: true,
      supportPoints: true,
      views: true,
      publishedAt: true,
    },
  });

  const items = [...manualVideos, ...autoVideos].slice(0, FEATURED_TOTAL);

  if (items.length === 0) return null;

  return <HeroCarouselClient items={items} />;
}
