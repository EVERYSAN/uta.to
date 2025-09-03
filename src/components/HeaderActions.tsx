"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type LastVideo = { videoId: string; title?: string; at?: number };

export default function HeaderActions() {
  const [last, setLast] = useState<LastVideo | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("lastVideo");
      if (raw) setLast(JSON.parse(raw));
    } catch {}
  }, []);

  return (
    <div className="hidden md:flex items-center gap-2">
      <Link
        href="/saved"
        prefetch={false}
        className="inline-flex items-center gap-2 rounded-md bg-zinc-900 hover:bg-zinc-800 px-3 py-2 text-sm"
      >
        💾 保存ページ
      </Link>
      {last && (
        <Link
          href={`/v/${last.videoId}`}
          prefetch={false}
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 hover:bg-zinc-800 px-3 py-2 text-sm max-w-[36ch] truncate"
          title={last.title ?? ""}
        >
          ▶ 続きから見る {last.title ? `：${last.title}` : ""}
        </Link>
      )}
    </div>
  );
}
