// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

// Next.js の HMR 環境でインスタンスを使い回す
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // ← stdout に出す（Vercel のログで見える）
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
