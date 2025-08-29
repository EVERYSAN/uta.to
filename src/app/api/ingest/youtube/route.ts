import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, message: "ingest-youtube: ready" });
}
return NextResponse.json({ ok: true, scanned, upserts });
