'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

// Legacy lobby page - EO-01 replaced with /host + /play + /join/[code]
function LobbyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams.get('code');

  useEffect(() => {
    if (code) router.replace(`/join/${code}`);
    else router.replace('/');
  }, [code, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-white/50 animate-pulse">جاري التحويل...</p>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-white/50 animate-pulse">...</p></div>}>
      <LobbyContent />
    </Suspense>
  );
}
