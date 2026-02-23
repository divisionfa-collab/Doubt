'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/lib/useSocket';
import { GamePhase, PlayerRole, PHASE_INFO } from '@/types/game';
import { CinematicOverlay, useCinematicOverlay } from '@/components/CinematicOverlay';

function HostContent() {
  const router = useRouter();
  const {
    isConnected, session, isHost, myRole, phaseData, nightTarget,
    morningResult, voteUpdate, voteResult, messages, mafiaMessages, nightReadiness, gameOver, error,
    createSession, hostStartGame, hostSetPhase, hostOpenChat, hostCloseChat,
    hostOpenVoting, hostCloseVoting, hostResolveNight, hostSendPrompt,
    initAudio, toggleMute,
  } = useSocket();

  const [hasCreated, setHasCreated] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [copied, setCopied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { overlayState, triggerPhaseTransition, triggerBloodSplash } = useCinematicOverlay();

  // Phase cinematics for host too
  useEffect(() => {
    if (phaseData?.phase && session?.isStarted) triggerPhaseTransition(phaseData.phase);
  }, [phaseData?.phase]);

  useEffect(() => {
    if (voteResult?.eliminated) triggerBloodSplash();
  }, [voteResult]);

  // Auto-create session
  useEffect(() => {
    if (isConnected && !hasCreated) {
      createSession().then(ok => {
        if (!ok) setTimeout(() => router.push('/'), 2000);
        else initAudio();
      });
      setHasCreated(true);
    }
  }, [isConnected, hasCreated]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Parse roles from myRole.teammates (host receives "name:ROLE" format)
  const playerRoles = myRole?.teammates.map(t => {
    const [name, role] = t.split(':');
    return { name, role };
  }) || [];

  const roleIcons: Record<string, string> = { MAFIA: '🔪', CITIZEN: '🏘️', DOCTOR: '🩺', DETECTIVE: '🕵️' };
  const roleNames: Record<string, string> = { MAFIA: 'مافيا', CITIZEN: 'مدني', DOCTOR: 'طبيب', DETECTIVE: 'محقق' };

  const copyLink = () => {
    if (!session) return;
    const url = `${window.location.origin}/join/${session.code}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrompt = async () => {
    if (!promptText.trim()) return;
    await hostSendPrompt(promptText.trim());
    setPromptText('');
  };

  const currentPhase = session?.phase || GamePhase.LOBBY;
  const phaseInfo = PHASE_INFO[currentPhase];
  const alivePlayers = session?.players.filter(p => p.isAlive) || [];
  const deadPlayers = session?.players.filter(p => !p.isAlive) || [];

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center phase-lobby">
        <p className="text-2xl text-doubt-muted animate-pulse">جاري إنشاء الجلسة...</p>
      </div>
    );
  }

  // GAME OVER
  if (gameOver || session.isGameOver) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 phase-result">
        <div className="text-center animate-fade-in max-w-lg w-full">
          <div className="text-8xl mb-4">🏁</div>
          <h1 className="text-4xl font-bold mb-2">انتهت اللعبة!</h1>
          <div className={`text-3xl font-bold mb-6 ${gameOver?.winner === 'MAFIA_WIN' ? 'text-doubt-accent' : 'text-green-400'}`}>
            {gameOver?.winnerName} فازوا! 🎉
          </div>
          <div className="space-y-2 mb-6">
            {(gameOver?.players || session.players).map(p => (
              <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl ${p.isAlive ? 'bg-white/10' : 'bg-white/5 opacity-60'}`}>
                <span className="text-xl">{roleIcons[p.role || ''] || '👤'}</span>
                <span className="flex-1">{p.name}</span>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  p.role === 'MAFIA' ? 'bg-doubt-accent/20 text-doubt-accent' :
                  p.role === 'DOCTOR' ? 'bg-blue-500/20 text-blue-400' :
                  p.role === 'DETECTIVE' ? 'bg-purple-500/20 text-purple-400' :
                  'bg-green-500/20 text-green-400'
                }`}>{roleNames[p.role || ''] || '?'}</span>
                {!p.isAlive && <span>💀</span>}
              </div>
            ))}
          </div>
          <button onClick={() => router.push('/')} className="w-full py-3 bg-doubt-accent rounded-xl text-lg font-bold">🏠 العودة</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col phase-lobby">
      <CinematicOverlay state={overlayState} />
      {/* Top Bar */}
      <div className="bg-black/50 border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-doubt-gold font-bold">🎮 المدير</span>
          <span className="text-xs text-doubt-muted bg-white/5 px-2 py-1 rounded">{phaseInfo.icon} {phaseInfo.name}</span>
          {session.isStarted && <span className="text-xs text-doubt-gold">R{session.round}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsMuted(toggleMute())}
            className="text-xs bg-white/5 px-2 py-1 rounded hover:bg-white/10 transition-colors">
            {isMuted ? '🔇' : '🔊'}
          </button>
          <span className="text-xs text-doubt-muted">{session.players.length} لاعب</span>
          <span className="text-xs font-mono text-doubt-gold">{session.code}</span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Control Panel */}
        <div className="w-72 bg-black/30 border-l border-white/10 flex flex-col overflow-y-auto p-3 space-y-3">

          {/* Join Link */}
          {!session.isStarted && (
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-xs text-doubt-muted mb-2">رابط الانضمام</p>
              <button onClick={copyLink}
                className="w-full py-2 bg-doubt-gold/20 text-doubt-gold rounded-lg text-sm font-bold transition-all hover:bg-doubt-gold/30">
                {copied ? '✅ تم النسخ!' : '📋 نسخ الرابط'}
              </button>
            </div>
          )}

          {/* Players */}
          <div className="bg-white/5 rounded-xl p-3">
            <p className="text-xs text-doubt-muted mb-2">اللاعبون ({alivePlayers.length} حي)</p>
            <div className="space-y-1">
              {session.players.map(p => {
                const roleInfo = playerRoles.find(r => r.name === p.name);
                return (
                  <div key={p.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${!p.isAlive ? 'opacity-40 line-through' : 'bg-white/5'}`}>
                    <span>{!p.isAlive ? '💀' : roleInfo ? roleIcons[roleInfo.role] || '👤' : '👤'}</span>
                    <span className="flex-1">{p.name}</span>
                    {roleInfo && <span className="text-doubt-muted">{roleNames[roleInfo.role] || ''}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Game Controls */}
          {!session.isStarted ? (
            <button onClick={hostStartGame} disabled={session.players.length < 2}
              className="w-full py-3 bg-doubt-accent hover:bg-doubt-accent/80 rounded-xl font-bold transition-all
                         disabled:opacity-30 disabled:cursor-not-allowed">
              🚀 ابدأ اللعبة ({session.players.length})
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-doubt-muted">التحكم بالمراحل</p>

              {/* Phase flow guide - next step glows, all buttons always work */}
              {(() => {
                const allReady = nightReadiness?.allReady || false;
                const hasVoteResult = !!voteResult;
                type StepId = 'night' | 'resolve' | 'discussion' | 'voting' | 'result';
                let nextStep: StepId = 'night';

                if (currentPhase === 'LOBBY') nextStep = 'night';
                if (currentPhase === 'NIGHT' && !allReady) nextStep = 'night';
                if (currentPhase === 'NIGHT' && allReady) nextStep = 'resolve';
                if (currentPhase === 'MORNING') nextStep = 'discussion';
                if (currentPhase === 'DISCUSSION') nextStep = 'voting';
                if (currentPhase === 'VOTING' && !hasVoteResult) nextStep = 'voting';
                if (currentPhase === 'VOTING' && hasVoteResult) nextStep = 'result';
                if (currentPhase === 'RESULT') nextStep = 'night';

                const isNext = (step: StepId) => nextStep === step;
                const normal = 'bg-white/5 text-white/60 hover:bg-white/10';
                const glow = (color: string) => `${color} ring-2 ring-white/30 shadow-lg shadow-white/5`;
                const glowPulse = (color: string) => `${color} ring-2 ring-white/30 shadow-lg shadow-white/5 animate-pulse`;

                return (
                  <>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button onClick={() => hostSetPhase('NIGHT')}
                        className={`py-2.5 rounded-lg text-xs font-bold transition-all ${
                          isNext('night') ? glow('bg-indigo-500/40 text-indigo-100') : normal
                        }`}>
                        🌙 ليل
                      </button>
                      <button onClick={hostResolveNight}
                        className={`py-2.5 rounded-lg text-xs font-bold transition-all ${
                          isNext('resolve') ? glowPulse('bg-green-500/40 text-green-100') : normal
                        }`}>
                        ⚡ نفّذ الليل
                      </button>
                      <button onClick={() => hostSetPhase('DISCUSSION')}
                        className={`py-2.5 rounded-lg text-xs font-bold transition-all ${
                          isNext('discussion') ? glow('bg-amber-500/40 text-amber-100') : normal
                        }`}>
                        💬 نقاش
                      </button>
                      <button onClick={() => hostSetPhase('VOTING')}
                        className={`py-2.5 rounded-lg text-xs font-bold transition-all ${
                          isNext('voting') ? glow('bg-emerald-500/40 text-emerald-100') : normal
                        }`}>
                        🗳️ تصويت
                      </button>
                      <button onClick={() => hostSetPhase('RESULT')}
                        className={`py-2.5 rounded-lg text-xs font-bold transition-all ${
                          isNext('result') ? glow('bg-purple-500/40 text-purple-100') : normal
                        }`}>
                        📊 نتيجة
                      </button>
                      <button onClick={() => hostSetPhase('MORNING')}
                        className={`py-2.5 rounded-lg text-xs font-bold transition-all ${normal}`}>
                        🌅 صباح
                      </button>
                    </div>
                  </>
                );
              })()}

              {/* Chat/Voting toggles */}
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={session.chatOpen ? hostCloseChat : hostOpenChat}
                  className={`py-2 rounded-lg text-xs font-bold transition-all ${session.chatOpen ? 'bg-green-500/30 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                  {session.chatOpen ? '🔓 شات مفتوح' : '🔒 شات مغلق'}
                </button>
                <button onClick={session.votingOpen ? hostCloseVoting : hostOpenVoting}
                  className={`py-2 rounded-lg text-xs font-bold transition-all ${session.votingOpen ? 'bg-green-500/30 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                  {session.votingOpen ? '🗳️ تصويت مفتوح' : '🗳️ تصويت مغلق'}
                </button>
              </div>

              {/* Vote Progress */}
              {voteUpdate && (
                <div className="bg-white/5 rounded-lg p-2">
                  <p className="text-xs text-doubt-muted">صوّت {voteUpdate.totalVotes} من {voteUpdate.totalEligible}</p>
                </div>
              )}

              {/* Vote Result */}
              {voteResult && (
                <div className="bg-white/5 rounded-lg p-2">
                  {voteResult.eliminated ? (
                    <p className="text-xs text-doubt-accent">⚖️ طرد: {voteResult.eliminatedName}</p>
                  ) : voteResult.isTie ? (
                    <p className="text-xs text-doubt-gold">تعادل</p>
                  ) : (
                    <p className="text-xs text-doubt-muted">لا تصويت</p>
                  )}
                </div>
              )}

              {/* Night Readiness Panel */}
              {currentPhase === 'NIGHT' && nightReadiness && (
                <div className="bg-white/5 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-doubt-muted font-bold">🌙 جاهزية الليل</p>
                  {nightReadiness.hasMafia && (
                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${nightReadiness.mafiaReady ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-doubt-muted'}`}>
                      <span>🔪</span>
                      <span className="flex-1">المافيا</span>
                      <span>{nightReadiness.mafiaReady ? '✓ جاهز' : '⏳ ينتظر...'}</span>
                    </div>
                  )}
                  {nightReadiness.hasDoctor && (
                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${nightReadiness.doctorReady ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-doubt-muted'}`}>
                      <span>🩺</span>
                      <span className="flex-1">الطبيب</span>
                      <span>{nightReadiness.doctorReady ? '✓ جاهز' : '⏳ ينتظر...'}</span>
                    </div>
                  )}
                  {nightReadiness.hasDetective && (
                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${nightReadiness.detectiveReady ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-doubt-muted'}`}>
                      <span>🕵️</span>
                      <span className="flex-1">المحقق</span>
                      <span>{nightReadiness.detectiveReady ? '✓ جاهز' : '⏳ ينتظر...'}</span>
                    </div>
                  )}
                  {nightReadiness.allReady && (
                    <div className="mt-1 text-center">
                      <span className="text-[10px] text-green-400 animate-pulse">✨ الجميع جاهز - نفّذ الليل!</span>
                    </div>
                  )}
                </div>
              )}

              {/* Morning Result */}
              {morningResult && (
                <div className="bg-white/5 rounded-lg p-2">
                  {morningResult.killed ? (
                    <p className="text-xs text-doubt-accent">💀 قُتل: {morningResult.killedName}</p>
                  ) : (
                    <p className="text-xs text-green-400">😌 لم يُقتل أحد</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Mafia Chat (Host sees it) */}
          {mafiaMessages.length > 0 && (
            <div className="bg-doubt-accent/5 border border-doubt-accent/20 rounded-xl p-3">
              <p className="text-xs text-doubt-accent font-bold mb-2">🔴 قناة المافيا</p>
              {mafiaMessages.map(msg => (
                <div key={msg.id} className="text-xs text-doubt-accent/80 mb-1">
                  <span className="font-bold">{msg.playerName}:</span> {msg.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Main Area - Chat */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {messages.length === 0 && (
              <div className="text-center py-12">
                <p className="text-doubt-muted/30 text-sm">💬 لا رسائل بعد</p>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.isHost ? 'justify-center' : 'justify-end'}`}>
                {msg.isHost ? (
                  <div className="bg-doubt-gold/10 border border-doubt-gold/20 px-4 py-2 rounded-2xl max-w-[85%]">
                    <p className="text-sm text-doubt-gold">{msg.text}</p>
                  </div>
                ) : (
                  <div className="bg-white/5 px-3 py-2 rounded-2xl rounded-tl-sm max-w-[75%]">
                    <p className="text-xs text-doubt-muted font-bold mb-0.5">{msg.playerName}</p>
                    <p className="text-sm">{msg.text}</p>
                    <p className="text-[10px] text-doubt-muted/40 mt-0.5">{new Date(msg.timestamp).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Host Prompt Input */}
          <div className="border-t border-white/10 p-3">
            <div className="flex gap-2">
              <input type="text" value={promptText} onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePrompt()}
                placeholder="أرسل رسالة للجميع..."
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm
                           placeholder:text-doubt-muted/50 focus:outline-none focus:border-doubt-gold/30" dir="rtl" />
              <button onClick={handlePrompt} disabled={!promptText.trim()}
                className="px-6 py-3 bg-doubt-gold/20 text-doubt-gold rounded-xl text-sm font-bold
                           transition-all disabled:opacity-30 hover:bg-doubt-gold/30">
                إرسال
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-doubt-accent/90 px-4 py-2 rounded-xl text-sm z-50">
          {error}
        </div>
      )}
    </div>
  );
}

export default function HostPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center phase-lobby"><p className="text-doubt-muted animate-pulse">جاري التحميل...</p></div>}>
      <HostContent />
    </Suspense>
  );
}
