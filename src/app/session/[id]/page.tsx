'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import LiveSessionView from '@/components/LiveSessionView';
import { RemoteSessionStore } from '@/lib/sessionStore';

export default function LiveSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const store = useMemo(() => new RemoteSessionStore(params.id), [params.id]);

  return <LiveSessionView store={store} onEnded={() => router.push('/')} />;
}
