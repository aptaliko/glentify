'use client';

import { useEffect, useState } from 'react';
import { nativeApiFetch } from '@/lib/nativeApiFetch';

interface Region {
  id: number;
  name: string;
  parentId: number | null;
}

export default function RegionsAdminPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await nativeApiFetch('/api/regions');
    setRegions(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await nativeApiFetch('/api/regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId: parentId ? Number(parentId) : null }),
    });
    if (!res.ok) {
      setError('Αποτυχία δημιουργίας περιοχής');
      return;
    }
    setName('');
    setParentId('');
    await load();
  }

  async function handleDelete(id: number) {
    setError(null);
    const res = await nativeApiFetch(`/api/regions/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error);
      return;
    }
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Περιοχές</h1>
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα περιοχής" className="input input-bordered flex-1" required />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="select select-bordered">
          <option value="">Χωρίς γονική περιοχή</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">Προσθήκη</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {regions.map((r) => (
          <li key={r.id} className="list-row items-center">
            <span>
              {r.name}
              {r.parentId ? ` (γονική: ${regions.find((p) => p.id === r.parentId)?.name ?? '?'})` : ''}
            </span>
            <button onClick={() => handleDelete(r.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
