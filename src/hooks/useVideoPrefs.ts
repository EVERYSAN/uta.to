// src/hooks/useVideoPrefs.ts
"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Prefs = {
  shorts: "off" | "all";
  minSec: number;              // 既定 61（ショート除外）
  sort: "trending24h" | "points" | "newest";
};

const KEY = "video:prefs";

export function useVideoPrefs() {
  const router = useRouter();
  const sp = useSearchParams();
  const [prefs, setPrefs] = useState<Prefs>(() => ({
    shorts: (sp.get("shorts") as any) || "off",
    minSec: Number(sp.get("minSec") || 61),
    sort: (sp.get("sort") as any) || "trending24h",
  }));

  // 1) 初回に localStorage を反映
  useEffect(() => {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as Partial<Prefs>;
        setPrefs((p) => ({
          shorts: (saved.shorts as any) || p.shorts,
          minSec: typeof saved.minSec === "number" ? saved.minSec : p.minSec,
          sort: (saved.sort as any) || p.sort,
        }));
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 変更時に URL & localStorage に保存（shallow）
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("shorts", prefs.shorts);
    url.searchParams.set("minSec", String(prefs.minSec));
    url.searchParams.set("sort", prefs.sort);
    window.history.replaceState(null, "", url.toString()); // shallow 書換
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs]);

  return { prefs, setPrefs } as const;
}
