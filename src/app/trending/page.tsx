// src/app/trending/page.tsx
import { redirect } from "next/navigation";

type SP = { [key: string]: string | string[] | undefined };

export default function TrendingPage({ searchParams }: { searchParams?: SP }) {
  const get = (k: string, def = "") =>
    typeof searchParams?.[k] === "string" ? (searchParams![k] as string) : def;

  const q     = get("q", "");
  const page  = get("page", "1");
  const take  = get("take", "50");
  const period= get("period", "day"); // day | week | month を想定

  const url = `/?sort=trending&period=${encodeURIComponent(period)}`
    + (q     ? `&q=${encodeURIComponent(q)}`     : "")
    + (page  ? `&page=${encodeURIComponent(page)}` : "")
    + (take  ? `&take=${encodeURIComponent(take)}` : "");

  redirect(url);
}
