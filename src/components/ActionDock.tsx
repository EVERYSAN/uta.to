"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type LastVideo = { videoId: string; title?: string; at?: number };

export default function ActionDock() {
  const [last, setLast] = useState<LastVideo | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("lastVideo");
      if (raw) setLast(JSON.parse(raw));
    } catch {}
  }, []);

  return (
    <div className="md:hidden fixed inset-x-0 bottom-0 z-50">
      <div
        className="mx-auto max-w-7xl px-3 pb-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        <div className="flex gap-2 rounded-2xl bg-zinc-900/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-900/70 border border-zinc-800 p-2 shadow-lg">
          <Link
            href="/saved"
            prefetch={false}
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-zinc-800 text-white px-3 py-2 text-sm"
          >
            💾 保存
          </Link>
          {last && (
            <Link
              href={`/v/${last.videoId}`}
              prefetch={false}
              className="flex-[2] inline-flex items-center justify-center gap-1 rounded-xl bg-violet-600 text-white px-3 py-2 text-sm truncate"
              title={last.title ?? ""}
            >
              ▶ 続きから {last.title ?? ""}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
