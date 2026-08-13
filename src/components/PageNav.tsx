'use client';

import Link from 'next/link';

export default function PageNav({ backHref, showHome = true }: { backHref: string; showHome?: boolean }) {
  return (
    <div className="flex gap-2 p-2">
      <Link href={backHref} className="btn btn-ghost btn-sm">← Πίσω</Link>
      {showHome && (
        <Link href="/" className="btn btn-ghost btn-sm">🏠 Αρχική</Link>
      )}
    </div>
  );
}
