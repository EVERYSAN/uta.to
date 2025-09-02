// src/app/api/cron/snapshot/route.ts
export const dynamic = "force-dynamic";

import { PrismaClient } from "@prisma/client";
import { fetchRecentYouTubeSinceHours } from "@/lib/youtube";

const prisma = new PrismaClient();

function authorized(req: Request) {
  const u = new URL(req.url);
  const s = process.env.CRON_SECRET ?? "";
  const ua = req.headers.get("user-agent") || "";
  return (
    req.headers.get("x-vercel-cron") !== null ||
    /vercel-cron/i.test(ua) ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === s ||
    u.searchParams.get("secret") === s
  );
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const t0 = Date.now();

  const url = new URL(req.url);
  const hours = Math.min(72, Math.max(6, Number(url.searchParams.get("sinceHours") || "48") || 48));
  const limit = Math.min(500, Math.max(50, Number(url.searchParams.get("limit") || "300") || 300));
  const query = url.searchParams.get("q") || undefined;

  const { items } = await fetchRecentYouTubeSinceHours(hours, { limit, query });

  let upserts = 0, errors: string[] = [];
  const now = new Date();

  for (const r of items) {
    try {
      const platform = "youtube";
      const platformVideoId = r.id;
      const publishedAt: Date | undefined = r.publishedAt ? new Date(r.publishedAt) : undefined;

      await prisma.video.upsert({
        where: { platform_platformVideoId: { platform, platformVideoId } }_
