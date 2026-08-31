'use client';

import Link from 'next/link';

export default function PageNav({
  backHref,
  onBack,
  showHome = true,
}: {
  backHref: string;
  /** When provided, "← Πίσω" becomes a same-page action instead of a Link — needed whenever
   * "back" isn't actually a different route (e.g. exiting an ephemeral mode rendered inline at
   * the caller's own URL), where a Link to the current URL would be a no-op. Takes priority
   * over `backHref` when given. */
  onBack?: () => void;
  showHome?: boolean;
}) {
  return (
    <nav aria-label="Πλοήγηση σελίδας" className="flex w-full gap-2 p-2">
      {onBack ? (
        <button onClick={onBack} className="btn btn-ghost btn-sm">← Πίσω</button>
      ) : (
        <Link href={backHref} className="btn btn-ghost btn-sm">← Πίσω</Link>
      )}
      {showHome && (
        <Link href="/" className="btn btn-ghost btn-sm">🏠 Αρχική</Link>
      )}
    </nav>
  );
}
