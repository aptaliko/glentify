'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Session {
  id: number;
  label: string | null;
}

export default function HomePage() {
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((session) => {
        setActiveSession(session);
        setLoaded(true);
      });
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
      <h1 className="text-4xl font-bold">Glentify</h1>

      {loaded && activeSession && (
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

      <Link href="/programs" className="btn btn-outline btn-lg">
        Σταθερά προγράμματα
      </Link>

      <Link href="/admin/songs" className="link">Διαχείριση (admin)</Link>
    </main>
  );
}
