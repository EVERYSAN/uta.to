// src/lib/url.ts
export function toSafeYouTubeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const allow = new Set([
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be',
    ]);
    if (!allow.has(u.hostname)) return '/'; // 想定外はトップへ逃がす
    return u.toString();
  } catch {
    return '/';
  }
}
