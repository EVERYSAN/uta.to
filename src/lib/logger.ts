// src/lib/logger.ts
export function logInfo(msg: string, meta?: any) {
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`, meta ?? "");
}
export function logWarn(msg: string, meta?: any) {
  console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, meta ?? "");
}
export function logError(msg: string, meta?: any) {
  console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, meta ?? "");
}
