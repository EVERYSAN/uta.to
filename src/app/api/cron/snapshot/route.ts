// src/app/api/cron/snapshot/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 自身のデプロイを叩くためのヘルパ
function selfUrl(path: string, search?: Record<string, string | number | boolean | null | undefined>) {
  // Vercel のランタイムで有効
  const base =
    process.env.VERCEL_URL?.startsWith("http")
      ? process.env.VERCEL_URL
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : ""; // ローカル fallback は相対で

  const u = new URL(path, base || "http://localhost:3000");
  if (search) {
    for (const [k, v] of Object.entries(search)) {
      if (v === undefined || v === null) continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

export async function GET() {
  const results: any[] = [];
  const warnings: string[] = [];

  // Deployment Protection を回避（ある場合）
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_TOKEN || process.env.PROTECTION_BYPASS_TOKEN || "";

  // refresh/youtube を毎回 no-store で叩く
  try {
    const url = selfUrl("/api/refresh/youtube", bypass
      ? {
          "x-vercel-protection-bypass": bypass,
          "x-vercel-set-bypass-cookie": true,
          limit: 32,
          hours: 6,
        }
      : {
          limit: 32,
          hours: 6,
        });

    const res = await fetch(url, {
      // ⚠ 警告回避のため、`cache: 'no-store'` のみに統一
      cache: "no-store",
    });

    // ここで res.ok が false でも throw しない
    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    results.push({ route: "refresh/youtube", status: res.status, ...data });
    if (!res.ok || data?.ok === false) {
      warnings.push(`refresh/youtube returned status=${res.status}, ok=${data?.ok}`);
    }
  } catch (e: any) {
    results.push({ route: "refresh/youtube", ok: false, error: e?.message || String(e) });
    warnings.push(`refresh/youtube error: ${e?.message || e}`);
  }

  // 必要なら他の更新処理もここに追加

  return NextResponse.json(
    {
      ok: warnings.length === 0,
      results,
      warnings,
      ts: new Date().toISOString(),
    },
    { status: 200 }
  );
}
