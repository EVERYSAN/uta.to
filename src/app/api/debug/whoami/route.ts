// src/app/api/_debug/whoami/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function maskDbUrl(raw?: string) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname;          // ← Neonはブランチ名がホストに入る
    const db   = u.pathname.replace("/", "");
    // 認証情報は返さない
    return { host, db, driver: u.protocol.replace(":", "") };
  } catch { return { host: "parse-error", db: null, driver: null }; }
}

export async function GET() {
  const env = process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  const dbInfo = maskDbUrl(process.env.DATABASE_URL);

  // 軽い実データ確認（重いと困るので最小限）
  const [videoCount, supportCount] = await Promise.all([
    prisma.video.count().catch(() => -1),
    prisma.supportEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 7*24*60*60*1000) } } }).catch(() => -1),
  ]);

  return NextResponse.json({
    vercelEnv: env,               // "production" | "preview" | "development"
    nodeEnv: process.env.NODE_ENV,
    database: dbInfo,             // { host, db, driver } だけ（安全に）
    counts: { videoCount, supportCountLast7d: supportCount },
  }, { headers: { "Cache-Control": "no-store" } });
}
