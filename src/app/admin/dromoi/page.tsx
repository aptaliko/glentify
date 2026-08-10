'use client';

import { useEffect, useState } from 'react';
import { nativeApiFetch } from '@/lib/nativeApiFetch';

interface Dromos {
  id: number;
  name: string;
}

export default function DromoiAdminPage() {
  const [dromoi, setDromoi] = useState<Dromos[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await nativeApiFetch('/api/dromoi');
    setDromoi(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await nativeApiFetch('/api/dromoi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setError('Αποτυχία δημιουργίας δρόμου');
      return;
    }
    setName('');
    await load();
  }

  async function handleDelete(id: number) {
    setError(null);
    const res = await nativeApiFetch(`/api/dromoi/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error);
      return;
    }
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Δρόμοι</h1>
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα δρόμου" className="input input-bordered flex-1" required />
        <button type="submit" className="btn btn-primary">Προσθήκη</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {dromoi.map((d) => (
          <li key={d.id} className="list-row items-center">
            <span>{d.name}</span>
            <button onClick={() => handleDelete(d.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
