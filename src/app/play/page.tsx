'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSocket } from '@/lib/useSocket';
import { GamePhase, PlayerRole, PHASE_INFO, MAX_MAFIA_CHAT_LENGTH, MAX_MAFIA_MESSAGES } from '@/types/game';
import { CinematicOverlay, useCinematicOverlay } from '@/components/CinematicOverlay';

// Visual Viewport hook - handles keyboard on ALL devices (iOS, Android, Samsung)
function useVisualViewportHeight() {
  useEffect(() => {
    const update = () => {
      const h = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--vh', `${h}px`);
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
}

// PostGame countdown timer (client display only, server-authoritative)
function PostGameTimer({ deadline }: { deadline: number }) {
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
    <div className="flex items-center justify-center gap-2">
      <span className="text-2xl font-bold text-doubt-gold">{secondsLeft}</span>
      <span className="text-xs text-doubt-muted">⏳</span>
    </div>
  );
}

// 💀 Dramatic death causes - deterministic per player name (same name = same cause)
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

function PlayContent() {
  useVisualViewportHeight(); // Native keyboard handling
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    isConnected, session, playerId, myRole, phaseData,
    nightTarget, morningResult, voteUpdate, voteResult, messages,
    mafiaMessages, detectiveResult, detectiveHistory, doctorConfirm, detectiveConfirm,
    chatOpen, votingOpen, gameOver, postGameStart, postGameUpdate, error,
    joinSession, selectNightTarget, doctorProtect, detectiveCheck,
    sendMafiaChat, castVote, sendMessage, postGameRespond, initAudio, toggleMute,
    startAmbient, stopAmbient,
  } = useSocket();

  const [hasJoined, setHasJoined] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [postGameChoice, setPostGameChoice] = useState<'continue' | 'exit' | null>(null);
  const [mafiaInput, setMafiaInput] = useState('');
  const [mafiaSentCount, setMafiaSentCount] = useState(0);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [showDetectiveLog, setShowDetectiveLog] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const { overlayState, triggerPhaseTransition, triggerBloodSplash } = useCinematicOverlay();

  // Game bulletin - track killed & eliminated
  const [killedList, setKilledList] = useState<string[]>([]);
  const [eliminatedList, setEliminatedList] = useState<string[]>([]);
  const [bulletinFlash, setBulletinFlash] = useState(false);
  const [deathOverlay, setDeathOverlay] = useState<{ show: boolean; cause: 'killed' | 'eliminated' } | null>(null);
  const [wasAlive, setWasAlive] = useState(true);
  const hasShownDeath = useRef(false);

  const code = searchParams.get('code') || '';
  const playerName = searchParams.get('name') || '';

  // Join (or reconnect handles it)
  useEffect(() => {
    if (!isConnected || hasJoined) return;
    // If session already set (from auto-reconnect), skip join
    if (session) { setHasJoined(true); return; }
    if (!code || !playerName) return;
    joinSession(code, playerName).then(ok => {
      if (!ok) setTimeout(() => router.push('/'), 2000);
      else {
        setHasJoined(true);
        // Init audio on first user interaction (join = user action)
        if (!audioStarted) {
          initAudio().then(() => setAudioStarted(true));
        }
      }
    });
  }, [isConnected, hasJoined, code, playerName, session]);

  // Phase transition cinematics
  useEffect(() => {
    if (phaseData?.phase && session?.isStarted) {
      triggerPhaseTransition(phaseData.phase);
    }
  }, [phaseData?.phase]);

  // Blood splash on vote elimination
  useEffect(() => {
    if (voteResult?.eliminated) triggerBloodSplash();
  }, [voteResult]);

  // 💓 Heartbeat ambient during DISCUSSION & VOTING
  useEffect(() => {
    if (!audioStarted || !session?.isStarted) return;
    const phase = phaseData?.phase || session?.phase;
    
    if (phase === 'DISCUSSION' || phase === 'VOTING') {
      // نبضات قلب — أعلى أثناء التصويت (توتر أكبر)
      const vol = phase === 'VOTING' ? 0.45 : 0.3;
      startAmbient('hart', vol, phase === 'VOTING' ? 1.0 : 2.5);
    } else {
      stopAmbient(1.5);
    }
  }, [phaseData?.phase, session?.phase, audioStarted]);

  // Reset on phase
  useEffect(() => {
    if (phaseData?.phase === 'NIGHT') { setSelectedTarget(null); setMyVote(null); setMafiaSentCount(0); setMafiaInput(''); }
    if (phaseData?.phase === 'VOTING') setMyVote(null);
    if (phaseData?.phase === 'LOBBY') { setSelectedTarget(null); setMyVote(null); setMafiaSentCount(0); }
  }, [phaseData?.phase]);

  // Bulletin: track kills
  useEffect(() => {
    if (morningResult?.killed && morningResult?.killedName) {
      setKilledList(prev => prev.includes(morningResult.killedName!) ? prev : [...prev, morningResult.killedName!]);
      setBulletinFlash(true);
      setTimeout(() => setBulletinFlash(false), 1500);
    }
  }, [morningResult]);

  // Bulletin: track eliminations
  useEffect(() => {
    if (voteResult?.eliminated && voteResult?.eliminatedName) {
      setEliminatedList(prev => prev.includes(voteResult.eliminatedName!) ? prev : [...prev, voteResult.eliminatedName!]);
      setBulletinFlash(true);
      setTimeout(() => setBulletinFlash(false), 1500);
    }
  }, [voteResult]);

  // Reset bulletin on new game
  useEffect(() => {
    if (session?.phase === 'LOBBY') { setKilledList([]); setEliminatedList([]); }
  }, [session?.phase]);

  // WhatsApp-style smart auto-scroll
  const scrollToBottom = (force = false) => {
    const el = messagesRef.current;
    if (!el) return;
    if (force) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    // Only auto-scroll if user is near bottom (within 150px)
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 150) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  };
  // Auto-scroll on new messages (smart - respects user scroll position)
  useEffect(() => { scrollToBottom(); }, [messages]);

  const isMafia = myRole?.role === PlayerRole.MAFIA;
  const isDoctor = myRole?.role === PlayerRole.DOCTOR;
  const isDetective = myRole?.role === PlayerRole.DETECTIVE;
  const amIAlive = session?.players.find(p => p.id === playerId)?.isAlive ?? true;
  const isSpectator = !amIAlive;
  const alivePlayers = session?.players.filter(p => p.isAlive) || [];
  const currentPhase = session?.phase || GamePhase.LOBBY;
  const phaseInfo = phaseData?.info || PHASE_INFO[currentPhase];

  // Detect death transition: alive → dead (once only, no repeat on reconnect)
  useEffect(() => {
    if (wasAlive && !amIAlive && session?.isStarted && !hasShownDeath.current) {
      hasShownDeath.current = true;
      const cause = currentPhase === GamePhase.RESULT || currentPhase === GamePhase.VOTING ? 'eliminated' : 'killed';
      setDeathOverlay({ show: true, cause });
      setTimeout(() => setDeathOverlay(null), 4000);
    }
    setWasAlive(amIAlive);
  }, [amIAlive]);

  // Reset spectator state on new game
  useEffect(() => {
    if (session?.phase === 'LOBBY') { setWasAlive(true); setDeathOverlay(null); hasShownDeath.current = false; setPostGameChoice(null); }
  }, [session?.phase]);

  // Force scroll when entering discussion phase
  useEffect(() => {
    if (currentPhase === GamePhase.DISCUSSION) setTimeout(() => scrollToBottom(true), 100);
  }, [currentPhase]);

  const roleIcons: Record<string, string> = { MAFIA: '🔪', CITIZEN: '🏘️', DOCTOR: '🩺', DETECTIVE: '🕵️' };
  const roleNames: Record<string, string> = { MAFIA: 'مافيا', CITIZEN: 'مدني', DOCTOR: 'طبيب', DETECTIVE: 'محقق' };
  const roleColors: Record<string, string> = { MAFIA: 'text-doubt-accent', CITIZEN: 'text-green-400', DOCTOR: 'text-blue-400', DETECTIVE: 'text-purple-400' };

  // Handlers
  const handleTarget = async (targetId: string) => {
    if (!amIAlive || currentPhase !== GamePhase.NIGHT) return;
    setSelectedTarget(targetId);
    if (isMafia) await selectNightTarget(targetId);
    else if (isDoctor) await doctorProtect(targetId);
    else if (isDetective) await detectiveCheck(targetId);
  };

  const handleSend = async () => {
    if (!chatInput.trim() || !chatOpen || !amIAlive) return;
    const ok = await sendMessage(chatInput.trim());
    if (ok) setChatInput('');
  };

  const handleMafiaSend = async () => {
    if (!mafiaInput.trim() || mafiaSentCount >= MAX_MAFIA_MESSAGES) return;
    const ok = await sendMafiaChat(mafiaInput.trim());
    if (ok) { setMafiaInput(''); setMafiaSentCount(prev => prev + 1); }
  };

  const handleVote = async (targetId: string) => {
    if (!votingOpen || !amIAlive) return;
    setMyVote(targetId);
    await castVote(targetId);
  };

  const getNightTargets = () => {
    if (!amIAlive) return [];
    if (isMafia) return alivePlayers.filter(p => p.id !== playerId && !myRole?.teammates.includes(p.name));
    if (isDoctor) return alivePlayers;
    if (isDetective) return alivePlayers.filter(p => p.id !== playerId);
    return [];
  };

  // Loading
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center phase-lobby">
        {error ? (
          <div className="text-center animate-fade-in">
            <p className="text-doubt-accent text-xl mb-2">❌ {error}</p>
            <p className="text-doubt-muted text-sm">جاري العودة...</p>
          </div>
        ) : (
          <p className="text-xl text-doubt-muted animate-pulse">جاري الاتصال...</p>
        )}
      </div>
    );
  }

  // Game Over - shows briefly before POST_GAME
  if ((gameOver || session.isGameOver) && session.phase === GamePhase.GAME_OVER) {
    const isMafiaWin = gameOver?.winner === 'MAFIA_WIN';
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0000 0%, #1a0505 40%, #0d0d0d 100%)' }}>
        {/* Blood drip effect */}
        <div className="absolute top-0 left-0 w-full h-1" style={{ background: 'linear-gradient(90deg, transparent, #8b0000, #ff0000, #8b0000, transparent)' }} />
        <div className="absolute top-0 left-[15%] w-1 h-16 rounded-b-full opacity-60" style={{ background: 'linear-gradient(180deg, #8b0000, transparent)' }} />
        <div className="absolute top-0 left-[45%] w-0.5 h-10 rounded-b-full opacity-40" style={{ background: 'linear-gradient(180deg, #8b0000, transparent)' }} />
        <div className="absolute top-0 right-[25%] w-1.5 h-20 rounded-b-full opacity-50" style={{ background: 'linear-gradient(180deg, #8b0000, transparent)' }} />
        <div className="absolute top-0 right-[60%] w-0.5 h-8 rounded-b-full opacity-30" style={{ background: 'linear-gradient(180deg, #8b0000, transparent)' }} />

        <div className="text-center animate-fade-in max-w-sm w-full relative z-10">
          {/* Skull / knife icon */}
          <div className="text-6xl mb-3">{isMafiaWin ? '🔪' : '⚰️'}</div>
          <h1 className="text-3xl font-bold mb-1 text-white/90">انتهت اللعبة</h1>
          <div className="text-2xl font-bold mb-5" style={{ color: isMafiaWin ? '#ff4444' : '#c9a84c' }}>
            {gameOver?.winnerName} فازوا
          </div>

          {/* Players list - dark cards */}
          <div className="space-y-1.5 mb-5">
            {(gameOver?.players || session.players).map(p => (
              <div key={p.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${
                !p.isAlive 
                  ? 'bg-black/40 border-red-900/30 opacity-50' 
                  : p.role === 'MAFIA' 
                    ? 'bg-red-950/30 border-red-800/30' 
                    : 'bg-white/5 border-white/5'
              }`}>
                <span className="text-lg">{roleIcons[p.role || ''] || '👤'}</span>
                <span className="flex-1 text-sm text-white/80">{p.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  p.role === 'MAFIA' ? 'bg-red-900/40 text-red-400' :
                  p.role === 'DOCTOR' ? 'bg-white/5 text-blue-300/70' :
                  p.role === 'DETECTIVE' ? 'bg-white/5 text-purple-300/70' :
                  'bg-white/5 text-white/40'
                }`}>{roleNames[p.role || '']}</span>
                {!p.isAlive && <span className="text-sm font-medium text-red-400/90 mr-1" style={{ textShadow: '0 0 8px rgba(255,60,60,0.6), 0 0 16px rgba(255,0,0,0.3)' }}>{getDeathCause(p.name)}</span>}
              </div>
            ))}
          </div>

          <p className="text-white/20 text-xs animate-pulse">في انتظار المدير...</p>
        </div>

        {/* Subtle red vignette */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 50%, rgba(100,0,0,0.15) 100%)' }} />
      </div>
    );
  }

  // POST_GAME - Continue/Exit choice
  if (session.phase === GamePhase.POST_GAME && postGameStart) {
    const deadline = postGameStart.deadline;
    const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 phase-lobby">
        <div className="text-center animate-fade-in max-w-sm w-full">
          <div className="text-6xl mb-4">🎬</div>
          <h1 className="text-2xl font-bold mb-2">انتهت الجولة</h1>
          <p className={`text-lg font-bold mb-6 ${postGameStart.winner === 'MAFIA' ? 'text-doubt-accent' : 'text-green-400'}`}>
            الفائز: {postGameStart.winnerName}
          </p>

          {!postGameChoice ? (
            <>
              <p className="text-doubt-muted text-sm mb-4">هل ترغب في جولة جديدة؟</p>
              <div className="space-y-3 mb-6">
                <button onClick={() => { setPostGameChoice('continue'); postGameRespond('continue'); }}
                  className="w-full py-3.5 bg-green-500/20 text-green-400 border-2 border-green-500/30 rounded-xl font-bold text-lg hover:bg-green-500/30 active:scale-95 transition-all">
                  ✅ أستمر
                </button>
                <button onClick={() => { setPostGameChoice('exit'); postGameRespond('exit'); }}
                  className="w-full py-3.5 bg-red-500/10 text-red-400 border-2 border-red-500/20 rounded-xl font-bold text-lg hover:bg-red-500/20 active:scale-95 transition-all">
                  ❌ أعتذر
                </button>
              </div>
              <PostGameTimer deadline={deadline} />
            </>
          ) : (
            <div className="animate-fade-in">
              <div className={`text-5xl mb-4 ${postGameChoice === 'continue' ? '' : ''}`}>
                {postGameChoice === 'continue' ? '✅' : '👋'}
              </div>
              <p className="text-doubt-muted text-lg mb-2">
                {postGameChoice === 'continue' ? 'تم تسجيل اختيارك' : 'شكراً لمشاركتك!'}
              </p>
              {postGameChoice === 'continue' && (
                <p className="text-doubt-muted/50 text-xs">في انتظار البقية...</p>
              )}
              {postGameUpdate && (
                <div className="mt-4 bg-white/5 rounded-xl p-3">
                  <p className="text-xs text-doubt-muted">
                    ✅ {postGameUpdate.continueCount} مستمر · ❌ {postGameUpdate.exitCount} معتذر
                    <span className="text-doubt-gold ml-2">
                      ({postGameUpdate.totalPlayers - postGameUpdate.continueCount - postGameUpdate.exitCount} منتظر)
                    </span>
                  </p>
                </div>
              )}
              {postGameChoice === 'exit' && (
                <button onClick={() => router.push('/')} className="mt-4 w-full py-3 bg-doubt-accent rounded-xl font-bold">
                  🏠 خروج
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Lobby - waiting
  if (!session.isStarted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 phase-lobby">
        <div className="text-center animate-fade-in">
          <h1 className="text-4xl font-bold text-doubt-gold mb-2">DOUBT</h1>
          <p className="text-doubt-muted mb-6">في انتظار بدء اللعبة...</p>
          <div className="text-6xl mb-4">⏳</div>
          <p className="text-doubt-gold text-lg">{playerName}</p>
          <p className="text-doubt-muted text-sm mt-2">{session.players.length} لاعب في الجلسة</p>
        </div>
      </div>
    );
  }

  // ========== GAME ==========
  const phaseBackground = currentPhase === GamePhase.NIGHT ? 'phase-night'
    : currentPhase === GamePhase.MORNING ? 'phase-morning'
    : currentPhase === GamePhase.VOTING ? 'phase-voting'
    : currentPhase === GamePhase.RESULT ? 'phase-result'
    : 'phase-lobby';

  return (
    <div className={`flex flex-col overflow-hidden phase-transition ${phaseBackground}`} style={{ height: 'var(--vh, 100dvh)' }}>
      <CinematicOverlay state={overlayState} />
      {currentPhase === GamePhase.NIGHT && <div className="fixed inset-0 cinema-vignette-red pointer-events-none z-10" />}

      {/* Death Overlay - role-specific cinematic transition to spectator */}
      {deathOverlay?.show && (() => {
        const roleMsg = isMafia ? 'المخاطرة كانت جزءاً من اللعبة… شاهد من يكمل المهمة.'
          : isDetective ? 'شكراً لمحاولتك كشف الحقيقة… راقب من سيصدقها.'
          : isDoctor ? 'حاولت الحماية… الآن شاهد من سينجو.'
          : 'سقطت في هذه الجولة… راقب كيف ستنكشف الحقيقة.';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 animate-fade-in">
            <div className="text-center px-8">
              <div className="text-7xl mb-6 animate-pulse">{deathOverlay.cause === 'killed' ? '💀' : '⚖️'}</div>
              <p className="text-xl font-bold text-white/90 mb-3 leading-relaxed">{roleMsg}</p>
              <div className="mt-6 flex items-center justify-center gap-2 text-white/20">
                <span className="text-xs">👁️</span>
                <div className="w-16 h-0.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-white/30 rounded-full animate-pulse" style={{ width: '100%' }} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Top Bar */}
      <div className="bg-black/50 border-b border-white/10 px-3 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {myRole && (
            <span className={`text-xs font-bold px-2 py-1 rounded-full border ${
              isMafia ? 'bg-doubt-accent/20 text-doubt-accent border-doubt-accent/30' :
              isDoctor ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
              isDetective ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
              'bg-green-500/20 text-green-400 border-green-500/30'
            }`}>
              {roleIcons[myRole.role]} {roleNames[myRole.role]}
            </span>
          )}
          {!amIAlive && <span className="text-[10px] text-white/60 bg-white/10 px-2 py-0.5 rounded-full border border-white/10">👁️ وضع المشاهدة</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsMuted(toggleMute())}
            className="text-xs bg-white/5 px-2 py-1 rounded hover:bg-white/10 transition-colors">
            {isMuted ? '🔇' : '🔊'}
          </button>
          <span className="text-xs bg-white/5 px-2 py-1 rounded">{phaseInfo.icon} {phaseInfo.name}</span>
          <span className="text-xs text-doubt-gold">R{session.round}</span>
          {isDetective && detectiveHistory.length > 0 && (
            <button onClick={() => setShowDetectiveLog(!showDetectiveLog)}
              className="text-xs bg-purple-500/20 text-purple-400 px-2 py-1 rounded-full">
              📋 {detectiveHistory.length}
            </button>
          )}
        </div>
      </div>

      {/* Game Bulletin - persistent status bar with round info */}
      {session.isStarted && (killedList.length > 0 || eliminatedList.length > 0) && (
        <div className={`shrink-0 bg-black/60 border-b border-white/5 px-3 py-1.5 flex items-center justify-center gap-2 text-[11px] transition-all duration-300 ${bulletinFlash ? 'bg-doubt-accent/10' : ''}`}>
          <span className="text-doubt-gold/60 font-bold">R{session.round}</span>
          <span className="text-white/10">—</span>
          {killedList.length > 0 && (
            <span className={`flex items-center gap-1 text-red-400/80 ${bulletinFlash && morningResult?.killed ? 'animate-pulse' : ''}`}>
              <span className="text-red-300 font-bold">{killedList[killedList.length - 1]}</span>
              <span className="text-red-400/50">·</span>
              <span className="text-red-400/70" style={{ textShadow: '0 0 6px rgba(255,60,60,0.4)' }}>{getDeathCause(killedList[killedList.length - 1])}</span>
            </span>
          )}
          {eliminatedList.length > 0 && (
            <>
              {killedList.length > 0 && <span className="text-white/10">|</span>}
              <span className={`flex items-center gap-1 text-amber-400/80 ${bulletinFlash && voteResult?.eliminated ? 'animate-pulse' : ''}`}>
                ⚖️ <span className="text-amber-300 font-bold">{eliminatedList[eliminatedList.length - 1]}</span>
                <span className="text-amber-400/50">·</span>
                <span className="text-amber-400/70" style={{ textShadow: '0 0 6px rgba(255,180,60,0.4)' }}>🪢 أُعدم بحكم الأغلبية</span>
              </span>
            </>
          )}
          <span className="text-white/10">|</span>
          <span className="flex items-center gap-1 text-green-400/80">
            👥 <span className="text-green-300 font-bold">{alivePlayers.length}</span>
          </span>
        </div>
      )}

      {/* Detective notification */}
      {detectiveResult && (
        <div className={`mx-3 mt-2 px-4 py-2 rounded-xl text-sm font-bold text-center animate-fade-in shrink-0 ${
          detectiveResult.isMafia ? 'bg-red-900/90 text-red-200' : 'bg-purple-900/90 text-purple-200'
        }`}>
          🕵️ {detectiveResult.targetName}: {detectiveResult.isMafia ? '⚠️ عضو عصابة!' : '✅ بريء'}
        </div>
      )}

      {/* Detective Log */}
      {showDetectiveLog && (
        <div className="mx-3 mt-2 bg-black/90 border border-purple-500/30 rounded-xl p-3 animate-fade-in shrink-0">
          <h4 className="text-purple-400 text-xs font-bold mb-2">🕵️ سجل الفحوصات</h4>
          {detectiveHistory.map((r, i) => (
            <div key={i} className={`text-xs p-1.5 rounded mb-1 ${r.isMafia ? 'bg-red-500/10 text-red-300' : 'bg-green-500/10 text-green-300'}`}>
              {r.targetName}: {r.isMafia ? '⚠️ مافيا' : '✅ بريء'}
            </div>
          ))}
        </div>
      )}

      {/* ===== DISCUSSION: WhatsApp-style full chat ===== */}
      {currentPhase === GamePhase.DISCUSSION ? (
        <>
          {/* Messages area - scrollable */}
          <div ref={messagesRef} className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-2" style={{ WebkitOverflowScrolling: 'touch' }}>
            {messages.length === 0 && <div className="text-center py-8"><p className="text-doubt-muted/30 text-sm">💬 ابدأ النقاش...</p></div>}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.isHost ? 'justify-center' : msg.playerId === playerId ? 'justify-start' : 'justify-end'}`}>
                {msg.isHost ? (
                  <div className="bg-doubt-gold/10 border border-doubt-gold/20 px-4 py-2 rounded-2xl">
                    <p className="text-sm text-doubt-gold">{msg.text}</p>
                  </div>
                ) : (
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl ${
                    msg.playerId === playerId ? 'bg-doubt-gold/20 text-doubt-gold rounded-tr-sm' : 'bg-white/8 rounded-tl-sm'
                  }`}>
                    {msg.playerId !== playerId && <p className="text-xs text-doubt-muted font-bold mb-0.5">{msg.playerName}</p>}
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    <p className="text-[10px] text-doubt-muted/30 mt-0.5">{new Date(msg.timestamp).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input - fixed at bottom inside flex (WhatsApp style) */}
          {amIAlive ? (
            <div className="shrink-0 border-t border-white/10 px-3 py-2" style={{ background: '#0b0b0f', paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))' }}>
              <div className="flex items-end gap-2 max-w-md mx-auto">
                <input type="text" value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  onFocus={() => setTimeout(() => scrollToBottom(true), 300)}
                  placeholder={chatOpen ? 'اكتب رسالة...' : '🔒 الشات مغلق'}
                  disabled={!chatOpen}
                  enterKeyHint="send"
                  autoComplete="off"
                  className="flex-1 bg-black/60 border border-white/20 rounded-full px-4 py-2.5 text-sm text-white
                             placeholder:text-white/30 focus:outline-none focus:border-doubt-gold/50
                             disabled:opacity-30" dir="rtl" />
                <button onClick={handleSend} disabled={!chatOpen || !chatInput.trim()}
                  className="w-10 h-10 bg-doubt-gold/30 text-doubt-gold rounded-full flex items-center justify-center shrink-0
                             text-lg transition-all disabled:opacity-30 active:scale-90">
                  ↑
                </button>
              </div>
            </div>
          ) : (
            <div className="shrink-0 border-t border-white/5 px-3 py-2 flex items-center justify-center gap-3" style={{ background: '#0b0b0f' }}>
              <span className="text-[10px] bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-white/25">👁️ مشاهدة</span>
              <span className="text-[11px] text-white/20">تقرأ النقاش فقط</span>
            </div>
          )}
        </>
      ) : (
        /* ===== NON-CHAT PHASES ===== */
        <div className="flex-1 overflow-y-auto">

          {/* NIGHT */}
          {currentPhase === GamePhase.NIGHT && (
            <div className="p-4">
              {amIAlive && (isMafia || isDoctor || isDetective) ? (
                <div className="animate-fade-in">
                  <h3 className={`text-center text-sm font-bold mb-4 ${isMafia ? 'text-doubt-accent' : isDoctor ? 'text-blue-400' : 'text-purple-400'}`}>
                    {isMafia ? '🔪 اختر ضحية' : isDoctor ? '🩺 اختر من تحمي' : '🕵️ اختر من تفحص'}
                  </h3>
                  <div className="space-y-2 max-w-sm mx-auto">
                    {getNightTargets().map(p => {
                      const sel = selectedTarget === p.id;
                      return (
                        <button key={p.id} onClick={() => handleTarget(p.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                            sel ? (isMafia ? 'bg-doubt-accent/30 border-2 border-doubt-accent' : isDoctor ? 'bg-blue-500/30 border-2 border-blue-500' : 'bg-purple-500/30 border-2 border-purple-500')
                              : 'bg-white/5 border-2 border-transparent hover:bg-white/10'
                          }`}>
                          <span>{sel ? (isMafia ? '🎯' : isDoctor ? '🛡️' : '🔍') : '👤'}</span>
                          <span className="flex-1 text-right">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Mafia chat */}
                  {isMafia && (
                    <div className="mt-4 max-w-sm mx-auto border-t border-doubt-accent/20 pt-3">
                      <p className="text-doubt-accent text-xs font-bold mb-0.5 text-center">🔒 قناة العصابة (سريّة)</p>
                      <p className="text-white/20 text-[10px] mb-2 text-center">نسّقوا مع أفراد العصابة لاختيار الضحية</p>
                      <div className="max-h-20 overflow-y-auto space-y-1 mb-2">
                        {mafiaMessages.map(msg => (
                          <div key={msg.id} className={`text-xs px-2 py-1 rounded-lg ${msg.playerId === playerId ? 'bg-doubt-accent/15 text-doubt-accent' : 'bg-white/5'}`}>
                            <span className="font-bold">{msg.playerName}: </span>{msg.text}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input type="text" value={mafiaInput}
                          onChange={(e) => setMafiaInput(e.target.value.slice(0, MAX_MAFIA_CHAT_LENGTH))}
                          onKeyDown={(e) => e.key === 'Enter' && handleMafiaSend()}
                          placeholder={mafiaSentCount >= MAX_MAFIA_MESSAGES ? 'انتهت' : 'سرية...'}
                          disabled={mafiaSentCount >= MAX_MAFIA_MESSAGES}
                          className="flex-1 bg-doubt-accent/5 border border-doubt-accent/20 rounded-lg px-3 py-2 text-xs disabled:opacity-30" dir="rtl" />
                        <button onClick={handleMafiaSend} disabled={mafiaSentCount >= MAX_MAFIA_MESSAGES || !mafiaInput.trim()}
                          className="px-3 py-2 bg-doubt-accent/20 text-doubt-accent rounded-lg text-xs font-bold disabled:opacity-30">
                          {mafiaSentCount}/{MAX_MAFIA_MESSAGES}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 animate-fade-in">
                  {isSpectator ? (
                    <div className="max-w-sm mx-auto">
                      {/* Spectator night view - live match feel */}
                      <div className="text-center mb-4">
                        <span className="text-xs bg-white/5 border border-white/10 px-3 py-1 rounded-full text-white/30">👁️ وضع المشاهدة</span>
                      </div>
                      <div className="text-center py-6">
                        <div className="text-5xl mb-3 animate-pulse">🌙</div>
                        <p className="text-white/40 text-sm">الجميع يتحرك في الظلام...</p>
                      </div>
                      {/* Status bar */}
                      <div className="bg-white/3 border border-white/5 rounded-xl p-3 mt-4 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/30">👥 متبقين</span>
                          <span className="text-green-400 font-bold">{alivePlayers.length}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/30">🔄 الجولة</span>
                          <span className="text-doubt-gold font-bold">{session.round}</span>
                        </div>
                        {killedList.length > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-white/30">🩸 آخر ضحية</span>
                            <span className="text-red-400">{killedList[killedList.length - 1]}</span>
                          </div>
                        )}
                        {eliminatedList.length > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-white/30">⚖️ آخر طرد</span>
                            <span className="text-amber-400">{eliminatedList[eliminatedList.length - 1]}</span>
                          </div>
                        )}
                      </div>
                      {/* Alive players list */}
                      <div className="mt-3">
                        <p className="text-[10px] text-white/20 mb-1.5 text-center">اللاعبون المتبقون</p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                          {alivePlayers.map(p => (
                            <span key={p.id} className="text-[11px] bg-white/5 px-2 py-0.5 rounded-full text-white/40">{p.name}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-16">
                      <div className="text-6xl mb-4">🌙</div>
                      <p className="text-doubt-muted text-lg">😴 نم بسلام...</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* MORNING */}
          {currentPhase === GamePhase.MORNING && (
            <div className="p-4 text-center py-16 animate-fade-in">
              {morningResult?.killed ? (
                <>
                  <div className="text-6xl mb-3">💀</div>
                  <p className="text-2xl font-bold text-doubt-accent">{morningResult.killedName} قُتل!</p>
                </>
              ) : (
                <>
                  <div className="text-6xl mb-3">😌</div>
                  <p className="text-2xl font-bold text-green-400">لم يُقتل أحد</p>
                </>
              )}
            </div>
          )}

          {/* VOTING */}
          {currentPhase === GamePhase.VOTING && (
            <div className="p-4">
              {amIAlive && votingOpen ? (
                <div className="max-w-sm mx-auto animate-fade-in">
                  <h3 className="text-doubt-gold text-center text-sm font-bold mb-2">🗳️ صوّت لطرد المشبوه</h3>

                  {/* Live vote progress */}
                  <div className="text-center mb-4">
                    <div className="inline-flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full">
                      <span className="text-xs text-doubt-gold font-bold">
                        {voteUpdate ? `${voteUpdate.totalVotes}/${voteUpdate.totalEligible}` : `0/${alivePlayers.length}`}
                      </span>
                      <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-doubt-gold rounded-full transition-all duration-500"
                          style={{ width: `${voteUpdate ? (voteUpdate.totalVotes / voteUpdate.totalEligible * 100) : 0}%` }} />
                      </div>
                      <span className="text-[10px] text-doubt-muted">صوّتوا</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {alivePlayers.filter(p => p.id !== playerId).map(p => {
                      const voteCount = voteUpdate?.counts?.find(c => c.playerId === p.id)?.votes || 0;
                      const maxVotes = voteUpdate?.totalVotes || 1;
                      const pct = maxVotes > 0 ? (voteCount / maxVotes * 100) : 0;
                      return (
                        <button key={p.id} onClick={() => handleVote(p.id)}
                          className={`w-full relative overflow-hidden rounded-xl transition-all ${
                            myVote === p.id ? 'border-2 border-doubt-gold' : 'border-2 border-transparent hover:border-white/10'
                          }`}>
                          {/* Vote progress bar background */}
                          <div className="absolute inset-0 bg-doubt-gold/10 rounded-xl transition-all duration-500"
                            style={{ width: `${pct}%` }} />
                          <div className={`relative flex items-center gap-3 p-3 ${myVote === p.id ? 'bg-doubt-gold/15' : 'bg-white/5'}`}>
                            <span>{myVote === p.id ? '✋' : '👤'}</span>
                            <span className="flex-1 text-right">{p.name}</span>
                            {voteCount > 0 && (
                              <span className="text-xs text-doubt-gold font-bold bg-doubt-gold/10 px-2 py-0.5 rounded-full">
                                {voteCount}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="max-w-sm mx-auto animate-fade-in">
                  {isSpectator ? (
                    <>
                      <div className="text-center mb-3">
                        <span className="text-[10px] bg-white/5 border border-white/10 px-3 py-1 rounded-full text-white/25">👁️ وضع المشاهدة</span>
                      </div>
                      <h3 className="text-doubt-gold/60 text-center text-sm font-bold mb-2">🗳️ التصويت جارٍ</h3>
                      {/* Show live progress for spectators too */}
                      {voteUpdate && (
                        <div className="text-center mb-4">
                          <div className="inline-flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full">
                            <span className="text-xs text-doubt-gold font-bold">
                              {voteUpdate.totalVotes}/{voteUpdate.totalEligible}
                            </span>
                            <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full bg-doubt-gold rounded-full transition-all duration-500"
                                style={{ width: `${voteUpdate.totalVotes / voteUpdate.totalEligible * 100}%` }} />
                            </div>
                            <span className="text-[10px] text-doubt-muted">صوّتوا</span>
                          </div>
                        </div>
                      )}
                      {/* Read-only candidate list with vote counts */}
                      <div className="space-y-2">
                        {alivePlayers.map(p => {
                          const voteCount = voteUpdate?.counts?.find(c => c.playerId === p.id)?.votes || 0;
                          const maxVotes = voteUpdate?.totalVotes || 1;
                          const pct = maxVotes > 0 ? (voteCount / maxVotes * 100) : 0;
                          return (
                            <div key={p.id} className="w-full relative overflow-hidden rounded-xl border border-white/5">
                              <div className="absolute inset-0 bg-doubt-gold/10 rounded-xl transition-all duration-500" style={{ width: `${pct}%` }} />
                              <div className="relative flex items-center gap-3 p-3 bg-white/3">
                                <span>👤</span>
                                <span className="flex-1 text-right text-white/60">{p.name}</span>
                                {voteCount > 0 && (
                                  <span className="text-xs text-doubt-gold font-bold bg-doubt-gold/10 px-2 py-0.5 rounded-full">{voteCount}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-doubt-muted">{!votingOpen ? '🔒 التصويت مغلق' : ''}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* RESULT */}
          {currentPhase === GamePhase.RESULT && (
            <div className="p-4 text-center py-12 animate-fade-in">
              {voteResult?.eliminated ? (
                <>
                  <div className="text-5xl mb-3">⚖️</div>
                  <p className="text-2xl font-bold text-doubt-accent">طُرد {voteResult.eliminatedName}!</p>
                </>
              ) : voteResult?.isTie ? (
                <>
                  <div className="text-5xl mb-3">⚖️</div>
                  <p className="text-2xl font-bold text-doubt-gold">تعادل! لا أحد يُطرد</p>
                </>
              ) : (
                <p className="text-xl text-doubt-muted">لم يصوّت أحد</p>
              )}
              {voteResult?.voteCounts && voteResult.voteCounts.length > 0 && (
                <div className="mt-4 max-w-xs mx-auto space-y-1">
                  {voteResult.voteCounts.map(vc => (
                    <div key={vc.playerId} className="flex items-center gap-2 bg-white/5 p-2 rounded-lg">
                      <span className="flex-1 text-right text-sm">{vc.playerName}</span>
                      <span className="text-xs text-doubt-gold font-mono">{vc.count}🗳️</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 bg-doubt-accent/90 px-4 py-2 rounded-xl text-sm z-50 animate-fade-in">
          {error}
        </div>
      )}
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center phase-lobby"><p className="text-doubt-muted animate-pulse">جاري التحميل...</p></div>}>
      <PlayContent />
    </Suspense>
  );
}
