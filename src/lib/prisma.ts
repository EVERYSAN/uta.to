// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

// Next.js (dev/hmr) でも使い回せるようにグローバルへキャッシュ
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // ← ここがポイント：event で発火させる
    log: [
      { level: "warn", emit: "event" },
      { level: "error", emit: "event" },
      // 必要なら query/info も追加可
      // { level: "query", emit: "event" },
      // { level: "info", emit: "event" },
    ],
  });

// dev では再生成を避ける
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ここでイベントを拾える（型エラーが消える）
prisma.$on("warn", (e) => console.warn("[Prisma warn]", e));
prisma.$on("error", (e) => console.error("[Prisma error]", e));

export default prisma;
