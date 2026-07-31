'use client';

import { useRouter } from 'next/navigation';
import SongPicker from '@/components/SongPicker';

export default function NewSessionPage() {
  const router = useRouter();

  async function handleSelect(songId: number) {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startingSongId: songId }),
    });
    const session = await res.json();
    router.push(`/session/${session.id}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">Ξεκίνα γλέντι — διάλεξε πρώτο τραγούδι</h1>
      <SongPicker onSelect={handleSelect} />
    </main>
  );
}
