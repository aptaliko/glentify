'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { isNativePlatform } from '@/lib/platform';
import { saveAuthToken } from '@/lib/authToken';
import { apiUrl } from '@/lib/apiClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(apiUrl('/api/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === 'string' ? body.error : 'Κάτι πήγε στραβά');
      return;
    }
    if (isNativePlatform()) {
      const body = await res.json();
      await saveAuthToken(body.token);
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <form onSubmit={handleSubmit} className="card-body gap-3">
          <h1 className="card-title text-2xl">Glentify</h1>
          {error && (
            <div role="alert" className="alert alert-error">
              <span>{error}</span>
            </div>
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="input input-bordered input-lg w-full"
            autoFocus
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Κωδικός"
            className="input input-bordered input-lg w-full"
            required
          />
          <button type="submit" className="btn btn-primary btn-lg">Είσοδος</button>
          <div className="flex justify-between text-sm">
            <Link href="/register" className="link">Νέος λογαριασμός</Link>
            <Link href="/forgot-password" className="link">Ξέχασα τον κωδικό</Link>
          </div>
        </form>
      </div>
    </main>
  );
}
