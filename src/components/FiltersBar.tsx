// src/components/FiltersBar.tsx
"use client";
import { useVideoPrefs } from "@/hooks/useVideoPrefs";

export default function FiltersBar() {
  const { prefs, setPrefs } = useVideoPrefs();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-zinc-900 p-3">
      {/* ショート除外 */}
      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4"
          checked={prefs.shorts === "off"}
          onChange={(e) =>
            setPrefs((p) => ({ ...p, shorts: e.target.checked ? "off" : "all", minSec: e.target.checked ? Math.max(61, p.minSec) : 0 }))
          }
        />
        <span className="text-sm">ショート除外</span>
      </label>

      {/* 最小尺 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">最小尺</span>
        <select
          value={prefs.minSec}
          onChange={(e) => setPrefs((p) => ({ ...p, minSec: Number(e.target.value) }))}
          className="rounded-md bg-zinc-800 px-2 py-1 text-sm"
        >
          <option value={0}>指定なし</option>
          <option value={61}>1分+</option>
          <option value={180}>3分+</option>
          <option value={300}>5分+</option>
          <option value={600}>10分+</option>
        </select>
      </div>

      {/* 並び替え */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">並び順</span>
        <select
          value={prefs.sort}
          onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value as any }))}
          className="rounded-md bg-zinc-800 px-2 py-1 text-sm"
        >
          <option value="trending24h">急上昇（24h + 応援）</option>
          <option value="points">応援ポイント順</option>
          <option value="newest">新着順</option>
        </select>
      </div>
    </div>
  );
}
