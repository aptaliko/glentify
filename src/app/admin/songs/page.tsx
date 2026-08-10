'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { isNativeApp } from '@/lib/platform';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedEditSongId } from '@/lib/adminEditStore';

interface Song {
  id: number;
  title: string;
  lyrics: string | null;
}

export default function SongsAdminPage() {
  const native = isNativeApp();
  const router = useRouter();
  const [songs, setSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState('');

  async function load(q: string) {
    const url = q ? `/api/songs?search=${encodeURIComponent(q)}` : '/api/songs';
    const res = await nativeApiFetch(url);
    setSongs(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load('');
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load(search);
  }

  async function handleOpenSong(id: number) {
    await setSelectedEditSongId(preferencesStore, id);
    router.push('/admin/local/songs/edit');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Τραγούδια</h1>
        <Link href="/admin/songs/new" className="btn btn-primary">Νέο τραγούδι</Link>
      </div>
      <form onSubmit={handleSearch} className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Αναζήτηση τίτλου" className="input input-bordered flex-1" />
        <button type="submit" className="btn">Αναζήτηση</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {songs.map((s) => (
          <li key={s.id} className="list-row items-center">
            {native ? (
              <button onClick={() => handleOpenSong(s.id)} className="link link-hover text-left">{s.title}</button>
            ) : (
              <Link href={`/admin/songs/${s.id}`} className="link link-hover">{s.title}</Link>
            )}
            {!s.lyrics && <span className="badge badge-warning badge-sm">λείπουν στίχοι</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
