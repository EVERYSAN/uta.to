import crypto from "crypto";

/** ヘッダからClient IP（X-Forwarded-For優先）を推定 */
export function getClientIp(req: Request): string {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}

/** リクエスト指紋（IPハッシュ + UA文字列） */
export function getRequestFingerprint(req: Request) {
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent") || "";
  const salt = process.env.SUPPORT_SALT || "support-salt";
  const hash = crypto.createHash("sha256").update(`${ip}|${salt}`).digest("hex");
  return { ip, ua, hash };
}

/** JST今日の0時(=UTCへ変換したDate) */
export function startOfTodayJSTUtc(): Date {
  const now = Date.now();
  const JST = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now + JST);
  const startJstMs = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate());
  return new Date(startJstMs - JST);
}

/** 期間パラメータ → 「JSTの本日0時から n 日前」 */
export function rangeToSince(range: "1d" | "7d" | "30d"): Date {
  const base = startOfTodayJSTUtc(); // 今日0時(JST)をUTCにしたDate
  const days = range === "30d" ? 30 : range === "7d" ? 7 : 1;
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000);
}

export const HOUR_MS = 3600_000;

export function floorToHourUtc(d = new Date()): Date {
  const x = new Date(d);
  x.setUTCMinutes(0, 0, 0);
  return x;
}

export function subHours(d: Date, hours: number) {
  return new Date(d.getTime() - hours * HOUR_MS);
}
