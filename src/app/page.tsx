'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { isNativeApp } from '@/lib/platform';
import { getAuthToken, clearAuthToken } from '@/lib/authToken';
import { apiUrl } from '@/lib/apiClient';
import { saveReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { hasLocalSession as checkHasLocalSession } from '@/lib/sessionStore';

interface Session {
  id: number;
  label: string | null;
}

export default function HomePage() {
  // Resolved during render (not in an effect) so server-prerender and client-hydration
  // agree on which branch to render, avoiding a flash of the wrong platform's UI. See
  // isNativeApp() and src/app/session/new/page.tsx for the same pattern.
  const native = isNativeApp();
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [hasLocalSession, setHasLocalSession] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error' | 'unauthorized'>('idle');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (native) {
      checkHasLocalSession(preferencesStore)
        .then(setHasLocalSession)
        .finally(() => setLoaded(true));
      return;
    }
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((session) => setActiveSession(session))
      .finally(() => setLoaded(true));
  }, [native]);

  async function handleLogout() {
    await fetch(apiUrl('/api/logout'), { method: 'POST' });
    window.location.href = '/login';
  }

  async function handleSync() {
    setSyncStatus('syncing');
    try {
      const token = await getAuthToken();
      const res = await fetch(apiUrl('/api/reference-data'), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status === 401) {
        await clearAuthToken();
        setSyncStatus('unauthorized');
        return;
      }
      if (!res.ok) throw new Error('sync failed');
      await saveReferenceData(await res.json());
      setSyncStatus('done');
    } catch {
      setSyncStatus('error');
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
      <h1 className="text-4xl font-bold">Glentify</h1>

      {native && loaded && (
        <div className="flex flex-col items-center gap-2">
          <button onClick={handleSync} className="btn btn-outline btn-sm" disabled={syncStatus === 'syncing'}>
            {syncStatus === 'syncing' ? 'Συγχρονισμός...' : 'Συγχρονισμός τραγουδιών'}
          </button>
          {syncStatus === 'done' && <p className="text-sm text-success">Έτοιμο για offline χρήση</p>}
          {syncStatus === 'error' && <p className="text-sm text-error">Ο συγχρονισμός απέτυχε — χρειάζεται σύνδεση</p>}
          {syncStatus === 'unauthorized' && (
            <Link href="/login" className="text-sm text-error underline">
              Η σύνδεση έληξε — ξανασυνδέσου
            </Link>
          )}
        </div>
      )}

      {native && loaded && hasLocalSession && (
        <div className="card w-full max-w-sm bg-warning/20 shadow">
          <div className="card-body items-center gap-2 text-center">
            <p>Έχεις ενεργό τοπικό γλέντι.</p>
            <Link href="/session/local" className="btn btn-primary btn-lg">
              Συνέχεια
            </Link>
          </div>
        </div>
      )}

      {!native && loaded && activeSession && (
        <div className="card w-full max-w-sm bg-warning/20 shadow">
          <div className="card-body items-center gap-2 text-center">
            <p>Έχεις ενεργό session{activeSession.label ? `: ${activeSession.label}` : ''}.</p>
            <Link href={`/session/${activeSession.id}`} className="btn btn-primary btn-lg">
              Συνέχεια
            </Link>
          </div>
        </div>
      )}

      <Link href="/session/new" className="btn btn-success btn-lg text-xl">
        Ξεκίνα γλέντι
      </Link>

      {!native && (
        <Link href="/programs" className="btn btn-outline btn-lg">
          Σταθερά προγράμματα
        </Link>
      )}

      {!native && <Link href="/admin/songs" className="link">Διαχείριση (admin)</Link>}

      {!native && (
        <div className="flex gap-4 text-sm">
          <Link href="/account" className="link">Λογαριασμός</Link>
          <button onClick={handleLogout} className="link">Αποσύνδεση</button>
        </div>
      )}
    </main>
  );
}
