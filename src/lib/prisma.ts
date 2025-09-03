import { PrismaClient } from "@prisma/client";

/**
 * Next.js (dev) の HMRでインスタンスが増殖しないようにグローバルに保持
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // ログは必要なら "query" などを足す
    log: [],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
