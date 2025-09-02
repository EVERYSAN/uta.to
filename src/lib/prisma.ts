// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [{ emit: "event", level: "error" }, { emit: "event", level: "warn" }],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// 追加：ログを標準出力へ（Vercel Functions で拾える）
prisma.$on("warn", (e) => console.warn("[Prisma warn]", e));
prisma.$on("error", (e) => console.error("[Prisma error]", e));
