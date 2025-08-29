import { NextResponse } from "next/server";
// import { prisma } from "@/lib/prisma"; // 本実装で使うなら

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // TODO: ここで実際の収集処理を実装して、件数を数える
    const scanned = 0;  // ← まずはダミー値
    const upserts = 0;  // ← まずはダミー値

    return NextResponse.json({ ok: true, scanned, upserts });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
