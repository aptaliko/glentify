'use client';

import { useState } from 'react';
import { apiUrl } from '@/lib/apiClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch(apiUrl('/api/forgot-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <div className="card-body gap-3">
          <h1 className="card-title text-2xl">Ξέχασα τον κωδικό</h1>
          {sent ? (
            <p>Αν υπάρχει λογαριασμός με αυτό το email, θα λάβεις σύνδεσμο επαναφοράς σε λίγο.</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="input input-bordered input-lg w-full"
                autoFocus
                required
              />
              <button type="submit" className="btn btn-primary btn-lg">Αποστολή συνδέσμου</button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
