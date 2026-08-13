'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/apiClient';
import PageNav from '@/components/PageNav';

export default function AccountPage() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    const res = await fetch(apiUrl('/api/account'), { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === 'string' ? body.error : 'Κάτι πήγε στραβά');
      return;
    }
    router.push('/login');
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <PageNav backHref="/" />
      <h1 className="text-xl font-bold">Λογαριασμός</h1>
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="btn btn-error">Διαγραφή λογαριασμού</button>
      ) : (
        <div className="flex flex-col gap-2">
          <p>Θα διαγραφούν μόνιμα όλα τα τραγούδια, προγράμματα και sessions σου. Είσαι σίγουρος/η;</p>
          <div className="flex gap-2">
            <button onClick={handleDelete} className="btn btn-error">Ναι, διάγραψέ τον</button>
            <button onClick={() => setConfirming(false)} className="btn btn-ghost">Άκυρο</button>
          </div>
        </div>
      )}
    </div>
  );
}
