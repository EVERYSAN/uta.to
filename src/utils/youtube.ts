// src/utils/youtube.ts
export function toYouTubeId(input?: string | null): string | null {
  if (!input) return null;

  // 既に11桁IDならそれを返す
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

  // URLから抽出
  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, '');

    // youtu.be/VIDEOID
    if (host === 'youtu.be') {
      const id = u.pathname.split('/')[1];
      if (id && /^[\w-]{11}/.test(id)) return id.substring(0, 11);
    }

    // youtube.com/watch?v=VIDEOID
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}/.test(v)) return v.substring(0, 11);

      // /embed/VIDEOID
      const parts = u.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('embed');
      if (i >= 0 && parts[i + 1] && /^[\w-]{11}/.test(parts[i + 1])) {
        return parts[i + 1].substring(0, 11);
      }

      // /shorts/VIDEOID
      if (parts[0] === 'shorts' && parts[1] && /^[\w-]{11}/.test(parts[1])) {
        return parts[1].substring(0, 11);
      }
    }
  } catch {
    /* fallthrough to regex */
  }

  // 生文字列から11桁らしきIDを拾う（最後の砦）
  const m = input.match(/([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
