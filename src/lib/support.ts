// src/lib/support.ts
import crypto from "crypto";

/** XFF / X-Real-IP からクライアントIPを推定（最初の1個を採用） */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = headers.get("x-real-ip");
  if (xri) return xri.trim();
  // Vercel/Edge だと直接は取れないことがあるのでフォールバック
  return "0.0.0.0";
}

/** UA と合わせてハッシュ化（簡易ななりすまし耐性）。ENV の SALT があれば使用。 */
export function ipFingerprint(ip: string, ua: string): string {
  const salt =
    process.env.SUPPORT_SALT ||
    process.env.SALT ||
    "dev-salt-change-me";
  return crypto
    .createHash("sha256")
    .update(`${ip}#${ua}#${salt}`)
    .digest("hex")
    .slice(0, 32); // 短めに
}

/** JST のその日の 00:00 を UTC に変換した Date を返す（“今日1回”判定用） */
export function startOfTodayJSTUtc(now = new Date()): Date {
  // now を JST にシフト
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  // JST の 00:00（= UTC で前日の 15:00 のこともある）を作ってから UTC に戻す
  const startJst = new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 0, 0, 0)
  );
  return new Date(startJst.getTime() - 9 * 60 * 60 * 1000);
}

/** Request から IP/UA/ハッシュをまとめて取得 */
export function getRequestFingerprint(req: Request) {
  const ip = getClientIp(req.headers);
  const ua = req.headers.get("user-agent") || "";
  const hash = ipFingerprint(ip, ua);
  return { ip, ua, hash };
}
