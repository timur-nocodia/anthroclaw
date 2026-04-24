'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function ChatIndex() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.serverId as string;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/fleet/${serverId}/agents`)
      .then((r) => r.json())
      .then((agents) => {
        if (Array.isArray(agents) && agents.length > 0) {
          router.replace(`/fleet/${serverId}/chat/${agents[0].id}`);
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [serverId, router]);

  if (loading) return <div className="flex-1 p-8 text-[var(--oc-text-muted)]">Loading...</div>;
  return <div className="flex-1 p-8 text-[var(--oc-text-muted)]">No agents. Create one first.</div>;
}
