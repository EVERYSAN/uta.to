import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // ...ここで実際の収集処理...
    // const scanned = items.length;
    // const upserts = upsertedCount;

    return NextResponse.json({ ok: true, scanned, upserts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? String(e) }, { status: 500 });
  }
}
