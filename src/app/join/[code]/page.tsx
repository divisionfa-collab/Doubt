'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

// EO-A01-HOTFIX: Only clear session data for DIFFERENT session, NEVER touch player_id
function prepareForJoin(currentCode: string) {
  try {
    const saved = localStorage.getItem('doubt_session');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.code !== currentCode) {
        localStorage.removeItem('doubt_session');
      }
    }
  } catch {
    localStorage.removeItem('doubt_session');
  }
}

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string || '').toUpperCase();
  const [name, setName] = useState('');

  const handleJoin = () => {
    if (name.trim() && code) {
      // Clear old session cache so browser focuses on new link
      prepareForJoin(code);
      router.push(`/play?code=${code}&name=${encodeURIComponent(name.trim())}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 phase-lobby">
      <div className="text-center mb-8 animate-fade-in">
        <h1 className="text-4xl font-bold text-doubt-gold mb-2">DOUBT</h1>
        <p className="text-doubt-muted">انضم للعبة</p>
        <div className="mt-4 text-3xl font-mono tracking-[0.3em] text-doubt-gold">{code}</div>
      </div>

      <div className="w-full max-w-sm space-y-4 animate-fade-in">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="اكتب اسمك" maxLength={12} autoFocus
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-center text-xl
                     placeholder:text-doubt-muted/50 focus:outline-none focus:border-doubt-gold/30" dir="rtl" />
        <button onClick={handleJoin} disabled={!name.trim()}
          className="w-full py-4 bg-doubt-accent hover:bg-doubt-accent/80 rounded-xl text-xl font-bold
                     transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]">
          🎯 دخول
        </button>
      </div>
    </div>
  );
}
