'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/apiClient';
import PageNav from '@/components/PageNav';

export default function AccountPage() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

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

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword !== confirmNewPassword) {
      setPasswordError('Οι νέοι κωδικοί δεν ταιριάζουν');
      return;
    }
    const res = await fetch(apiUrl('/api/account/change-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const body = await res.json();
      setPasswordError(typeof body.error === 'string' ? body.error : 'Κάτι πήγε στραβά');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordSuccess(true);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <PageNav backHref="/" />
      <h1 className="text-xl font-bold">Λογαριασμός</h1>

      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3 p-4">
          <h2 className="font-semibold">Αλλαγή κωδικού</h2>
          {passwordError && (
            <div role="alert" className="alert alert-error alert-sm">
              <span>{passwordError}</span>
            </div>
          )}
          {passwordSuccess && (
            <div role="alert" className="alert alert-success alert-sm">
              <span>Ο κωδικός άλλαξε επιτυχώς.</span>
            </div>
          )}
          <form onSubmit={handleChangePassword} className="flex flex-col gap-2">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Τρέχων κωδικός"
              className="input input-bordered"
              required
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Νέος κωδικός"
              className="input input-bordered"
              required
              minLength={8}
            />
            <input
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder="Επιβεβαίωση νέου κωδικού"
              className="input input-bordered"
              required
              minLength={8}
            />
            <button type="submit" className="btn btn-primary">Αλλαγή κωδικού</button>
          </form>
        </div>
      </div>

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
