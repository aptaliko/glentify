'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Program {
  id: number;
  title: string;
}

export default function ProgramsAdminPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/programs');
    setPrograms(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setError('Αποτυχία δημιουργίας προγράμματος');
      return;
    }
    setTitle('');
    await load();
  }

  async function handleDelete(id: number) {
    await fetch(`/api/programs/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Προγράμματα</h1>
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Τίτλος προγράμματος"
          className="input input-bordered flex-1"
          required
        />
        <button type="submit" className="btn btn-primary">Προσθήκη</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {programs.map((p) => (
          <li key={p.id} className="list-row items-center">
            <Link href={`/admin/programs/${p.id}`} className="link link-hover">{p.title}</Link>
            <button onClick={() => handleDelete(p.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
          </li>
        ))}
        {programs.length === 0 && <li className="list-row text-base-content/50">Κανένα πρόγραμμα ακόμη</li>}
      </ul>
    </div>
  );
}
