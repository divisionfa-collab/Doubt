'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [showJoin, setShowJoin] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 phase-lobby">
      <div className="text-center mb-12 animate-fade-in">
        <h1 className="text-6xl font-bold text-doubt-gold mb-3">DOUBT</h1>
        <p className="text-doubt-muted text-lg">لعبة الشك والخداع</p>
      </div>

      {!showJoin ? (
        <div className="w-full max-w-sm space-y-4 animate-fade-in">
          <button
            onClick={() => router.push('/host')}
            className="w-full py-4 bg-doubt-accent hover:bg-doubt-accent/80 rounded-xl text-xl font-bold transition-all hover:scale-[1.02] active:scale-[0.98]">
            🎮 أدر لعبة جديدة
          </button>
          <button
            onClick={() => setShowJoin(true)}
            className="w-full py-4 bg-white/10 hover:bg-white/15 rounded-xl text-xl font-bold transition-all">
            🎯 انضم كلاعب
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-4 animate-fade-in">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="اسمك" maxLength={12}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center text-lg
                       placeholder:text-doubt-muted/50 focus:outline-none focus:border-doubt-gold/30" dir="rtl" />
          <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="كود الجلسة" maxLength={4}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-[0.3em]
                       placeholder:text-doubt-muted/50 focus:outline-none focus:border-doubt-gold/30" dir="ltr" />
          <button
            onClick={() => name.trim() && code.trim() && router.push(`/play?code=${code}&name=${encodeURIComponent(name.trim())}`)}
            disabled={!name.trim() || code.length < 4}
            className="w-full py-4 bg-doubt-gold/20 text-doubt-gold hover:bg-doubt-gold/30 rounded-xl text-xl font-bold
                       transition-all disabled:opacity-30 disabled:cursor-not-allowed">
            دخول
          </button>
          <button onClick={() => setShowJoin(false)}
            className="w-full py-2 text-doubt-muted text-sm hover:text-white transition-colors">
            ← رجوع
          </button>
        </div>
      )}
    </div>
  );
}
