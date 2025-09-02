import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-6 space-y-3">
      <p>動画が見つかりませんでした。</p>
      <Link href="/" className="text-violet-400 hover:underline">トップへ戻る</Link>
    </div>
  );
}
