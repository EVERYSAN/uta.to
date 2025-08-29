import { PrismaClient } from "@prisma/client";

// グローバルに1個だけ保持して、開きすぎるのを防ぐ（Vercel等のサーバレス対策）
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    log: ["error", "warn"], // 必要なら "query" も追加可
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

export default prisma;
