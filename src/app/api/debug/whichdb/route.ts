import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const url = process.env.DATABASE_URL || "";
  // 例: postgres://user:pass@host:5432/dbname
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = `${u.hostname}:${u.port}`;
    db = u.pathname.replace(/^\//, "");
  } catch {}
  return NextResponse.json({
    ok: true,
    host,
    db,
    // セキュリティ上パスワードは絶対に返さない
    hasUrl: Boolean(url),
  });
}
