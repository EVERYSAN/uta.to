"use client";

import { useState } from "react";

export default function IngestNow() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    try {
      setLoading(true);
      setMsg(null);
      // GETでもOK。POSTにしたい場合は { method: "POST" } にする
      const res = await fetch("/api/ingest/youtube?manual=1", {
        method: "GET",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setMsg(`OK: scanned=${json.scanned ?? "?"}, upserts=${json.upserts ?? "?"}`);
    } catch (e: any) {
      setMsg(`エラー: ${e.message ?? String(e)}`);
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
