'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Program {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
}

function sharedBadgeText(emails: string[]): string {
  if (emails.length === 0) return '';
  if (emails.length === 1) return `μοιράζεται με ${emails[0]}`;
  return `μοιράζεται με ${emails[0]} +${emails.length - 1}`;
}

export default function ProgramsPage() {
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    fetch('/api/programs').then((r) => r.json()).then(setPrograms);
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">Σταθερά προγράμματα</h1>
      <div className="card w-full max-w-md bg-base-100 shadow">
        <div className="card-body gap-2">
          <ul className="flex flex-col gap-1">
            {programs.map((p) => (
              <li key={p.id} className="flex flex-col gap-1">
                <Link href={`/programs/${p.id}`} className="btn btn-outline btn-lg w-full">
                  {p.title}
                </Link>
                {p.sharedWithEmails.length > 0 && (
                  <span className="badge badge-ghost badge-sm self-center">{sharedBadgeText(p.sharedWithEmails)}</span>
                )}
              </li>
            ))}
            {programs.length === 0 && <li className="p-3 text-center text-sm text-base-content/50">Κανένα πρόγραμμα ακόμη</li>}
          </ul>
        </div>
      </div>
      <Link href="/" className="link">Αρχική</Link>
    </main>
  );
}
