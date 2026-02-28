'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/lib/useSocket';
import { GamePhase, PlayerRole, PHASE_INFO } from '@/types/game';
import { CinematicOverlay, useCinematicOverlay } from '@/components/CinematicOverlay';

// 💀 Dramatic death causes
const DEATH_CAUSES = [
  '🔫 طلق ناري في الظلام',
  '🗡️ طعنة غادرة',
  '🪢 شُنق عند الفجر',
  '🩸 نزيف حاد',
  '☠️ سُمّ في الشاي',
  '🔥 احترق وهو نائم',
  '💉 جرعة قاتلة',
  '🪓 ضربة فأس',
  '🌊 غرق في النهر',
  '⚡ صعقة كهربائية',
  '🧱 سقط من السطح',
  '🐍 لدغة أفعى',
  '💣 انفجار مفاجئ',
  '🥶 تجمّد في العاصفة',
  '🎭 خُنق بوسادة',
];
function getDeathCause(playerName: string): string {
  let hash = 0;
  for (let i = 0; i < playerName.length; i++) hash = ((hash << 5) - hash) + playerName.charCodeAt(i);
  return DEATH_CAUSES[Math.abs(hash) % DEATH_CAUSES.length];
}

// PostGame countdown for host
function PostGameTimerHost({ deadline }: { deadline: number }) {
  const [secondsLeft, setSecondsLeft] = useState(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline]);
  return (
    <span className="text-doubt-gold font-bold">⏳ {secondsLeft}s</span>
  );
}

function HostContent() {
  const router = useRouter();
  const {
    isConnected, session, isHost, myRole, phaseData, nightTarget,
    morningResult, voteUpdate, voteResult, messages, mafiaMessages, nightReadiness,
    gameOver, postGameStart, postGameUpdate, error,
    createSession, lockSessionCode, hostStartGame, hostSetPhase, hostOpenChat, hostCloseChat,
    hostOpenVoting, hostCloseVoting, hostResolveNight, hostSendPrompt, hostRestartGame,
    hostStartNewRound, initAudio, toggleMute,
  } = useSocket();

  const [hasCreated, setHasCreated] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [copied, setCopied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [gameOverLocal, setGameOverLocal] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { overlayState, triggerPhaseTransition, triggerBloodSplash } = useCinematicOverlay();

  useEffect(() => {
    if (phaseData?.phase && session?.isStarted) triggerPhaseTransition(phaseData.phase);
  }, [phaseData?.phase]);

  useEffect(() => {
    if (voteResult?.eliminated) triggerBloodSplash();
  }, [voteResult]);

  useEffect(() => {
    if (gameOver) setGameOverLocal(true);
  }, [gameOver]);

  // When session returns to lobby (after restart), dismiss game over
  useEffect(() => {
    if (session?.phase === 'LOBBY') setGameOverLocal(false);
  }, [session?.phase]);

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

  const playerRoles = myRole?.teammates.map(t => {
    const [name, role] = t.split(':');
    return { name, role };
  }) || [];

  const roleIcons: Record<string, string> = { MAFIA: '🔪', CITIZEN: '🏘️', DOCTOR: '🩺', DETECTIVE: '🕵️' };
  const roleNames: Record<string, string> = { MAFIA: 'مافيا', CITIZEN: 'مدني', DOCTOR: 'طبيب', DETECTIVE: 'محقق' };

  const copyLink = () => {
    if (!session) return;
    const url = `${window.location.origin}/join/${session.code}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt('انسخ الرابط:', url);
    }
  };

  const handlePrompt = async () => {
    if (!promptText.trim()) return;
    await hostSendPrompt(promptText.trim());
    setPromptText('');
  };

  const currentPhase = session?.phase || GamePhase.LOBBY;
  const phaseInfo = PHASE_INFO[currentPhase];
  const alivePlayers = session?.players.filter(p => p.isAlive) || [];

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center phase-lobby">
        <p className="text-2xl text-doubt-muted animate-pulse">جاري إنشاء الجلسة...</p>
      </div>
    );
  }

  // GAME OVER - Host sees roles, can trigger POST_GAME
  if (gameOverLocal && (gameOver || session.isGameOver) && currentPhase !== GamePhase.POST_GAME) {
    const isMafiaWin = gameOver?.winner === 'MAFIA_WIN';
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0000 0%, #1a0505 40%, #0d0d0d 100%)' }}>
        {/* Blood drip effect */}
        <div className="absolute top-0 left-0 w-full h-1" style={{ background: 'linear-gradient(90deg, transparent, #8b0000, #ff0000, #8b0000, transparent)' }} />
        <div className="absolute top-0 left-[15%] w-1 h-16 rounded-b-full opacity-60" style={{ background: 'linear-gradient(180deg, #8b0000, transparent)' }} />
        <div className="absolute top-0 left-[45%] w-0.5 h-10 rounded-b-full opacity-40" style={{ background: 'linear-gradient(180deg, #8b0000, transparent)' }} />
        <div className="absolute top-0 right-[25%] w-1.5 h-20 rounded-b-full opacity-50" style={{ background: 'linear-gradient(180deg, #8b0000, transparent)' }} />
        <div className="absolute top-0 right-[60%] w-0.5 h-8 rounded-b-full opacity-30" style={{ background: 'linear-gradient(180deg, #8b0000, transparent)' }} />

        <div className="text-center animate-fade-in max-w-lg w-full relative z-10">
          <div className="text-7xl mb-3">{isMafiaWin ? '🔪' : '⚰️'}</div>
          <h1 className="text-4xl font-bold mb-1 text-white/90">انتهت اللعبة</h1>
          <div className="text-3xl font-bold mb-6" style={{ color: isMafiaWin ? '#ff4444' : '#c9a84c' }}>
            {gameOver?.winnerName} فازوا
          </div>

          {/* Players reveal */}
          <div className="space-y-2 mb-6">
            {(gameOver?.players || session.players).map(p => (
              <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                !p.isAlive 
                  ? 'bg-black/40 border-red-900/30 opacity-60'
                  : p.role === 'MAFIA'
                    ? 'bg-red-950/30 border-red-800/30'
                    : 'bg-white/5 border-white/5'
              }`}>
                <span className="text-xl">{roleIcons[p.role || ''] || '👤'}</span>
                <span className="flex-1 text-white/80">{p.name}</span>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  p.role === 'MAFIA' ? 'bg-red-900/40 text-red-400' :
                  p.role === 'DOCTOR' ? 'bg-blue-900/30 text-blue-300/70' :
                  p.role === 'DETECTIVE' ? 'bg-purple-900/30 text-purple-300/70' :
                  'bg-white/5 text-white/40'
                }`}>{roleNames[p.role || ''] || '?'}</span>
                {!p.isAlive && <span className="text-sm font-medium text-red-400/90 mr-1" style={{ textShadow: '0 0 8px rgba(255,60,60,0.6), 0 0 16px rgba(255,0,0,0.3)' }}>{getDeathCause(p.name)}</span>}
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button onClick={async () => {
              await hostRestartGame();
              setGameOverLocal(false);
            }} className="flex-1 py-3 rounded-xl text-lg font-bold border transition-all hover:scale-[1.02]" style={{ background: 'rgba(139,0,0,0.2)', borderColor: 'rgba(255,68,68,0.3)', color: '#ff6666' }}>
              🎮 لعبة جديدة
            </button>
            <button onClick={() => router.push('/')} className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl text-lg font-bold text-white/50 hover:bg-white/10 transition-all">
              🚪 خروج
            </button>
          </div>
        </div>

        {/* Red vignette */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 50%, rgba(100,0,0,0.15) 100%)' }} />
      </div>
    );
  }

  // POST_GAME - Host dashboard: see who continues/exits
  if (currentPhase === GamePhase.POST_GAME && postGameStart) {
    const deadline = postGameStart.deadline;
    const continueCount = postGameUpdate?.continueCount || 0;
    const exitCount = postGameUpdate?.exitCount || 0;
    const pending = session.players.length - continueCount - exitCount;
    const canStart = continueCount >= 2;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 phase-lobby">
        <div className="text-center animate-fade-in max-w-lg w-full">
          <div className="text-6xl mb-4">🎬</div>
          <h1 className="text-3xl font-bold mb-2">بين الجولات</h1>
          <p className={`text-lg font-bold mb-6 ${postGameStart.winner === 'MAFIA' ? 'text-doubt-accent' : 'text-green-400'}`}>
            الفائز: {postGameStart.winnerName}
          </p>

          {/* Player Status Cards */}
          <div className="space-y-2 mb-6">
            {session.players.map(p => {
              const response = postGameUpdate?.responses?.[p.id];
              return (
                <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl ${
                  response === 'continue' ? 'bg-green-500/10 border border-green-500/20' :
                  response === 'exit' ? 'bg-red-500/10 border border-red-500/20 opacity-50' :
                  'bg-white/5 border border-white/10'
                }`}>
                  <span className="text-lg">
                    {response === 'continue' ? '✅' : response === 'exit' ? '❌' : '⏳'}
                  </span>
                  <span className="flex-1 text-right">{p.name}</span>
                  <span className={`text-xs ${
                    response === 'continue' ? 'text-green-400' :
                    response === 'exit' ? 'text-red-400' :
                    'text-doubt-muted animate-pulse'
                  }`}>
                    {response === 'continue' ? 'مستمر' : response === 'exit' ? 'معتذر' : 'منتظر...'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Summary Bar */}
          <div className="bg-white/5 rounded-xl p-3 mb-4 flex items-center justify-center gap-4 text-sm">
            <span className="text-green-400">✅ {continueCount}</span>
            <span className="text-red-400">❌ {exitCount}</span>
            <span className="text-doubt-muted">⏳ {pending}</span>
            <PostGameTimerHost deadline={deadline} />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button onClick={async () => {
              await hostStartNewRound();
              setGameOverLocal(false);
            }} disabled={!canStart}
              className={`flex-1 py-3 rounded-xl text-lg font-bold transition-all ${
                canStart
                  ? 'bg-doubt-gold/20 text-doubt-gold hover:bg-doubt-gold/30'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}>
              🚀 ابدأ الجولة الجديدة {canStart ? `(${continueCount})` : ''}
            </button>
          </div>
          {!canStart && <p className="text-xs text-doubt-muted mt-2">يجب وجود لاعبين على الأقل</p>}
        </div>
      </div>
    );
  }

  // ===== Phase Control Buttons =====
  const PhaseButtons = () => {
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
    const normal = 'bg-white/5 text-white/60 hover:bg-white/10 active:bg-white/15';
    const glow = (color: string) => `${color} ring-2 ring-white/30 shadow-lg shadow-white/5`;
    const glowPulse = (color: string) => `${color} ring-2 ring-white/30 shadow-lg shadow-white/5 animate-pulse`;

    return (
      <div className="grid grid-cols-3 gap-1.5">
        <button onClick={() => hostSetPhase('NIGHT')}
          className={`py-2.5 rounded-lg text-xs font-bold transition-all ${isNext('night') ? glow('bg-indigo-500/40 text-indigo-100') : normal}`}>
          🌙 ليل
        </button>
        <button onClick={hostResolveNight}
          className={`py-2.5 rounded-lg text-xs font-bold transition-all ${isNext('resolve') ? glowPulse('bg-green-500/40 text-green-100') : normal}`}>
          ⚡ نفّذ
        </button>
        <button onClick={() => hostSetPhase('DISCUSSION')}
          className={`py-2.5 rounded-lg text-xs font-bold transition-all ${isNext('discussion') ? glow('bg-amber-500/40 text-amber-100') : normal}`}>
          💬 نقاش
        </button>
        <button onClick={() => hostSetPhase('VOTING')}
          className={`py-2.5 rounded-lg text-xs font-bold transition-all ${isNext('voting') ? glow('bg-emerald-500/40 text-emerald-100') : normal}`}>
          🗳️ تصويت
        </button>
        <button onClick={() => hostSetPhase('RESULT')}
          className={`py-2.5 rounded-lg text-xs font-bold transition-all ${isNext('result') ? glow('bg-purple-500/40 text-purple-100') : normal}`}>
          📊 نتيجة
        </button>
        <button onClick={() => hostSetPhase('MORNING')}
          className={`py-2.5 rounded-lg text-xs font-bold transition-all ${normal}`}>
          🌅 صباح
        </button>
      </div>
    );
  };

  // ===== Status Info =====
  const StatusInfo = () => (
    <div className="space-y-2">
      {/* Chat/Voting toggles */}
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={session.chatOpen ? hostCloseChat : hostOpenChat}
          className={`py-2 rounded-lg text-xs font-bold transition-all ${session.chatOpen ? 'bg-green-500/30 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
          {session.chatOpen ? '🔓 شات' : '🔒 شات'}
        </button>
        <button onClick={session.votingOpen ? hostCloseVoting : hostOpenVoting}
          className={`py-2 rounded-lg text-xs font-bold transition-all ${session.votingOpen ? 'bg-green-500/30 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
          {session.votingOpen ? '🗳️ مفتوح' : '🗳️ مغلق'}
        </button>
      </div>

      {/* Vote Progress */}
      {voteUpdate && (
        <div className="bg-white/5 rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs text-doubt-muted">صوّت {voteUpdate.totalVotes} من {voteUpdate.totalEligible}</p>
            <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-doubt-gold rounded-full transition-all" style={{ width: `${voteUpdate.totalVotes / voteUpdate.totalEligible * 100}%` }} />
            </div>
          </div>
          {voteUpdate.counts && voteUpdate.counts.length > 0 && voteUpdate.counts.map(c => (
            <div key={c.playerId} className="flex items-center gap-2 text-xs">
              <span className="flex-1 text-right text-white/70">{c.playerName}</span>
              <span className="text-doubt-gold font-bold">{c.votes}</span>
            </div>
          ))}
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

      {/* Night Readiness */}
      {currentPhase === 'NIGHT' && nightReadiness && (
        <div className="bg-white/5 rounded-xl p-2 space-y-1">
          <p className="text-xs text-doubt-muted font-bold">🌙 جاهزية</p>
          {nightReadiness.hasMafia && (
            <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${nightReadiness.mafiaReady ? 'text-green-400' : 'text-doubt-muted'}`}>
              🔪 <span className="flex-1">المافيا</span> {nightReadiness.mafiaReady ? '✓' : '⏳'}
            </div>
          )}
          {nightReadiness.hasDoctor && (
            <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${nightReadiness.doctorReady ? 'text-green-400' : 'text-doubt-muted'}`}>
              🩺 <span className="flex-1">الطبيب</span> {nightReadiness.doctorReady ? '✓' : '⏳'}
            </div>
          )}
          {nightReadiness.hasDetective && (
            <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${nightReadiness.detectiveReady ? 'text-green-400' : 'text-doubt-muted'}`}>
              🕵️ <span className="flex-1">المحقق</span> {nightReadiness.detectiveReady ? '✓' : '⏳'}
            </div>
          )}
          {nightReadiness.allReady && (
            <p className="text-[10px] text-green-400 animate-pulse text-center">✨ الجميع جاهز!</p>
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
  );

  return (
    <div className="min-h-screen flex flex-col phase-lobby">
      <CinematicOverlay state={overlayState} />

      {/* Top Bar */}
      <div className="bg-black/50 border-b border-white/10 px-3 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-doubt-gold font-bold text-sm">🎮 المدير</span>
          <span className="text-[10px] text-doubt-muted bg-white/5 px-1.5 py-0.5 rounded">{phaseInfo.icon} {phaseInfo.name}</span>
          {session.isStarted && <span className="text-[10px] text-doubt-gold">R{session.round}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setIsMuted(toggleMute())}
            className="text-xs bg-white/5 px-2 py-1 rounded hover:bg-white/10">{isMuted ? '🔇' : '🔊'}</button>
          {session.isStarted && (
            <button onClick={() => setShowChat(!showChat)}
              className={`text-xs px-2 py-1 rounded transition-all md:hidden ${showChat ? 'bg-doubt-gold/30 text-doubt-gold' : 'bg-white/5'}`}>
              💬 {messages.length > 0 ? messages.length : ''}
            </button>
          )}
          <span className="text-[10px] text-doubt-muted">{session.players.length}👤</span>
          <span className="text-xs font-mono text-doubt-gold">{session.code}</span>
        </div>
      </div>

      {/* Host Bulletin */}
      {session.isStarted && (
        <div className="shrink-0 bg-black/40 border-b border-white/5 px-3 py-1 flex items-center justify-center gap-4 text-[11px]">
          <span className="text-red-400/80">💀 {session.players.filter(p => !p.isAlive).length}</span>
          <span className="text-green-400/80">👥 {session.players.filter(p => p.isAlive).length}</span>
          {morningResult?.killed && <span className="text-red-300">🩸 {morningResult.killedName}</span>}
          {voteResult?.eliminated && <span className="text-amber-300">⚖️ {voteResult.eliminatedName}</span>}
        </div>
      )}

      {/* ===== MOBILE LAYOUT ===== */}
      <div className="flex-1 flex flex-col md:hidden overflow-hidden">
        {/* Controls always visible on mobile */}
        <div className="bg-black/30 border-b border-white/10 p-3 space-y-2 shrink-0 overflow-y-auto max-h-[55vh]">
          {/* EO-L01: Session Code Lock */}
          {!session.isStarted && (
            <div className="bg-white/5 rounded-xl p-3 space-y-2">
              {!session.isCodeLocked ? (
                <>
                  <p className="text-[10px] text-doubt-muted text-center">🔓 كود الجلسة (قابل للتعديل)</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customCode}
                      onChange={(e) => setCustomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                      placeholder={session.code}
                      className="flex-1 bg-black/40 border border-white/20 rounded-lg px-3 py-2 text-sm 
                                 text-doubt-gold text-center font-mono tracking-widest uppercase
                                 placeholder:text-white/20 focus:outline-none focus:border-doubt-gold/50"
                      dir="ltr"
                    />
                    <button
                      onClick={async () => {
                        const code = customCode.trim() || session.code;
                        const ok = await lockSessionCode(code);
                        if (ok) setCustomCode('');
                      }}
                      className="px-4 py-2 bg-doubt-gold/20 text-doubt-gold rounded-lg text-sm font-bold 
                                 hover:bg-doubt-gold/30 transition-all whitespace-nowrap active:scale-95"
                    >
                      🔒 تثبيت
                    </button>
                  </div>
                  <p className="text-[10px] text-doubt-muted/50 text-center">ثبّت الكود قبل مشاركة الرابط</p>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-doubt-gold font-mono text-xl tracking-[0.3em] font-bold">{session.code}</span>
                    <span className="text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded-full">🔒 مثبت</span>
                  </div>
                  <button onClick={copyLink}
                    className="w-full py-2 bg-doubt-gold/20 text-doubt-gold rounded-lg text-sm font-bold hover:bg-doubt-gold/30 active:scale-95 transition-all">
                    {copied ? '✅ تم النسخ!' : '📋 نسخ رابط الدعوة'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Players - compact horizontal */}
          <div className="flex flex-wrap gap-1">
            {session.players.map(p => {
              const roleInfo = playerRoles.find(r => r.name === p.name);
              return (
                <span key={p.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] ${!p.isAlive ? 'opacity-40 line-through bg-white/5' : 'bg-white/5'}`}>
                  {!p.isAlive ? '💀' : roleInfo ? roleIcons[roleInfo.role] || '👤' : '👤'} {p.name}
                </span>
              );
            })}
          </div>

          {/* Game Controls */}
          {!session.isStarted ? (
            <button onClick={hostStartGame} disabled={session.players.length < 2}
              className="w-full py-3 bg-doubt-accent hover:bg-doubt-accent/80 rounded-xl font-bold disabled:opacity-30">
              🚀 ابدأ اللعبة ({session.players.length})
            </button>
          ) : (
            <>
              <PhaseButtons />
              <StatusInfo />
            </>
          )}

          {/* Mafia Chat */}
          {mafiaMessages.length > 0 && (
            <div className="bg-doubt-accent/5 border border-doubt-accent/20 rounded-lg p-2">
              <p className="text-[10px] text-doubt-accent font-bold mb-1">🔴 المافيا</p>
              {mafiaMessages.map(msg => (
                <div key={msg.id} className="text-[10px] text-doubt-accent/80">
                  <span className="font-bold">{msg.playerName}:</span> {msg.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat area (toggleable on mobile) */}
        {showChat && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && <p className="text-center text-doubt-muted/30 text-sm py-8">💬 لا رسائل</p>}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.isHost ? 'justify-center' : 'justify-end'}`}>
                {msg.isHost ? (
                  <div className="bg-doubt-gold/10 border border-doubt-gold/20 px-3 py-1.5 rounded-2xl">
                    <p className="text-xs text-doubt-gold">{msg.text}</p>
                  </div>
                ) : (
                  <div className="bg-white/5 px-3 py-1.5 rounded-2xl rounded-tl-sm max-w-[80%]">
                    <p className="text-[10px] text-doubt-muted font-bold">{msg.playerName}</p>
                    <p className="text-xs">{msg.text}</p>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}

        {/* Host chat input - ALWAYS visible on mobile when game started */}
        {session.isStarted && (
          <div className="shrink-0 border-t border-white/10 p-2" style={{ background: '#0b0b0f' }}>
            <div className="flex gap-2">
              <input type="text" value={promptText} onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handlePrompt(); } }}
                placeholder="👑 رسالة المدير..."
                enterKeyHint="send"
                className="flex-1 bg-black/60 border border-white/20 rounded-full px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-doubt-gold/50" dir="rtl" />
              <button onClick={handlePrompt} disabled={!promptText.trim()}
                className="w-10 h-10 bg-doubt-gold/30 text-doubt-gold rounded-full flex items-center justify-center shrink-0 text-lg disabled:opacity-30 active:scale-90">
                ↑
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===== DESKTOP LAYOUT ===== */}
      <div className="flex-1 hidden md:flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-72 bg-black/30 border-l border-white/10 flex flex-col overflow-y-auto p-3 space-y-3">
          {!session.isStarted && (
            <div className="bg-white/5 rounded-xl p-3 space-y-2">
              {!session.isCodeLocked ? (
                <>
                  <p className="text-xs text-doubt-muted">🔓 كود الجلسة</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customCode}
                      onChange={(e) => setCustomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                      placeholder={session.code}
                      className="flex-1 bg-black/40 border border-white/20 rounded-lg px-3 py-2 text-sm 
                                 text-doubt-gold text-center font-mono tracking-widest uppercase
                                 placeholder:text-white/20 focus:outline-none focus:border-doubt-gold/50"
                      dir="ltr"
                    />
                    <button
                      onClick={async () => {
                        const code = customCode.trim() || session.code;
                        const ok = await lockSessionCode(code);
                        if (ok) setCustomCode('');
                      }}
                      className="px-3 py-2 bg-doubt-gold/20 text-doubt-gold rounded-lg text-xs font-bold 
                                 hover:bg-doubt-gold/30 transition-all whitespace-nowrap"
                    >
                      🔒 تثبيت
                    </button>
                  </div>
                  <p className="text-[10px] text-doubt-muted/50 text-center">ثبّت الكود قبل مشاركة الرابط</p>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-doubt-muted">رابط الانضمام</p>
                    <span className="text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded-full">🔒 مثبت</span>
                  </div>
                  <div className="text-center mb-2">
                    <span className="text-doubt-gold font-mono text-2xl tracking-[0.3em] font-bold">{session.code}</span>
                  </div>
                  <button onClick={copyLink}
                    className="w-full py-2 bg-doubt-gold/20 text-doubt-gold rounded-lg text-sm font-bold hover:bg-doubt-gold/30">
                    {copied ? '✅ تم النسخ!' : '📋 نسخ الرابط'}
                  </button>
                </>
              )}
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

          {!session.isStarted ? (
            <button onClick={hostStartGame} disabled={session.players.length < 2}
              className="w-full py-3 bg-doubt-accent hover:bg-doubt-accent/80 rounded-xl font-bold disabled:opacity-30 disabled:cursor-not-allowed">
              🚀 ابدأ اللعبة ({session.players.length})
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-doubt-muted">التحكم</p>
              <PhaseButtons />
              <StatusInfo />
            </div>
          )}

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

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {messages.length === 0 && <p className="text-center py-12 text-doubt-muted/30 text-sm">💬 لا رسائل بعد</p>}
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
          <div className="border-t border-white/10 p-3">
            <div className="flex gap-2">
              <input type="text" value={promptText} onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePrompt()}
                placeholder="أرسل رسالة للجميع..."
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm placeholder:text-doubt-muted/50 focus:outline-none focus:border-doubt-gold/30" dir="rtl" />
              <button onClick={handlePrompt} disabled={!promptText.trim()}
                className="px-6 py-3 bg-doubt-gold/20 text-doubt-gold rounded-xl text-sm font-bold disabled:opacity-30 hover:bg-doubt-gold/30">
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
