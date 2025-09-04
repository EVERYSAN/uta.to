import { NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: Request): boolean {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  const fromCron = req.headers.get("x-vercel-cron");
  if (fromCron) return true;          // Vercel Cron
  if (!secret) return true;           // 秘密未設定なら緩め運用（必要なら false に）
  return token === secret;            // 手動実行は ?token=... で
}

export async function GET(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const tags = (url.searchParams.get("tag") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const paths = (url.searchParams.get("path") ?? "").split(",").map(s => s.trim()).filter(Boolean);

  const done: string[] = [];

  // 既定で飛ばしたい対象（あなたのプロジェクトに合わせて調整）
  const defaultTags = ["video:list", "video:24h"];
  const defaultPaths = ["/", "/ranking", "/recent", "/search"];

  try {
    if (all || (tags.length === 0 && paths.length === 0)) {
      for (const t of defaultTags) { revalidateTag(t); done.push(`tag:${t}`); }
      for (const p of defaultPaths) { revalidatePath(p); done.push(`path:${p}`); }
    }
    for (const t of tags) { revalidateTag(t); done.push(`tag:${t}`); }
    for (const p of paths) { revalidatePath(p); done.push(`path:${p}`); }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, revalidated: done, at: new Date().toISOString() });
}
