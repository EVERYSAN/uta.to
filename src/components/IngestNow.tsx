"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function IngestNow() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    try {
      setLoading(true);
      setMsg(null);
      const res = await fetch("/api/ingest/youtube?manual=1", {
        method: "GET",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      // いろんなキー名に対応して拾う
      const scanned =
        json.scanned ?? json.total ?? json.count ?? json.processed ?? "?";
      const upserts =
        json.upserts ?? json.inserted ?? json.updated ?? json.saved ?? "?";

      setMsg(`OK: scanned=${scanned}, upserts=${upserts}`);

      // 一覧を再取得（SSR再評価）
      router.refresh();
    } catch (e: any) {
      setMsg(`エラー: ${e?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button
        onClick={run}
        disabled={loading}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          background: loading ? "#999" : "black",
          color: "white",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "収集中..." : "今すぐ収集"}
      </button>
      {msg && <span style={{ fontSize: 12, color: "#444" }}>{msg}</span>}
    </div>
  );
}
