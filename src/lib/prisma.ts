// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

/** HMR対策でグローバルに保持 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [], // 必要なら "query" など追加
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
