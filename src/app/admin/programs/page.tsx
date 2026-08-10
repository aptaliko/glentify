'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sharedBadgeText } from '@/lib/programBadge';

interface Program {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
}

export default function ProgramsAdminPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

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

  function startEditing(p: Program) {
    setEditingId(p.id);
    setEditingTitle(p.title);
  }

  async function handleRename(e: React.FormEvent, id: number) {
    e.preventDefault();
    await fetch(`/api/programs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editingTitle }),
    });
    setEditingId(null);
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
          <li key={p.id} className="list-row items-center gap-2">
            {editingId === p.id ? (
              <form onSubmit={(e) => handleRename(e, p.id)} className="flex flex-1 gap-2">
                <input
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  className="input input-bordered input-sm flex-1"
                  autoFocus
                  required
                />
                <button type="submit" className="btn btn-primary btn-sm">Αποθήκευση</button>
                <button type="button" onClick={() => setEditingId(null)} className="btn btn-ghost btn-sm">Άκυρο</button>
              </form>
            ) : (
              <>
                <div className="flex flex-1 flex-col gap-1">
                  <Link href={`/admin/programs/${p.id}`} className="link link-hover">{p.title}</Link>
                  {p.sharedWithEmails.length > 0 && (
                    <span className="badge badge-ghost badge-xs w-fit">{sharedBadgeText(p.sharedWithEmails)}</span>
                  )}
                </div>
                <button onClick={() => startEditing(p)} className="btn btn-ghost btn-sm">Μετονομασία</button>
                {p.role === 'creator' && (
                  <button onClick={() => handleDelete(p.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
                )}
              </>
            )}
          </li>
        ))}
        {programs.length === 0 && <li className="list-row text-base-content/50">Κανένα πρόγραμμα ακόμη</li>}
      </ul>
    </div>
  );
}
