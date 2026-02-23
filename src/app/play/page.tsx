'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSocket } from '@/lib/useSocket';
import { GamePhase, PlayerRole, PHASE_INFO, MAX_MAFIA_CHAT_LENGTH, MAX_MAFIA_MESSAGES } from '@/types/game';
import { CinematicOverlay, useCinematicOverlay } from '@/components/CinematicOverlay';

function PlayContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    isConnected, session, playerId, myRole, phaseData,
    nightTarget, morningResult, voteUpdate, voteResult, messages,
    mafiaMessages, detectiveResult, detectiveHistory, doctorConfirm, detectiveConfirm,
    chatOpen, votingOpen, gameOver, error,
    joinSession, selectNightTarget, doctorProtect, detectiveCheck,
    sendMafiaChat, castVote, sendMessage, initAudio, toggleMute,
  } = useSocket();

  const [hasJoined, setHasJoined] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [mafiaInput, setMafiaInput] = useState('');
  const [mafiaSentCount, setMafiaSentCount] = useState(0);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [showDetectiveLog, setShowDetectiveLog] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { overlayState, triggerPhaseTransition, triggerBloodSplash } = useCinematicOverlay();

  const code = searchParams.get('code') || '';
  const playerName = searchParams.get('name') || '';

  // Join
  useEffect(() => {
    if (!isConnected || hasJoined || !code || !playerName) return;
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
  }, [isConnected, hasJoined, code, playerName]);

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

  // Reset on phase
  useEffect(() => {
    if (phaseData?.phase === 'NIGHT') { setSelectedTarget(null); setMyVote(null); setMafiaSentCount(0); setMafiaInput(''); }
    if (phaseData?.phase === 'VOTING') setMyVote(null);
  }, [phaseData?.phase]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const isMafia = myRole?.role === PlayerRole.MAFIA;
  const isDoctor = myRole?.role === PlayerRole.DOCTOR;
  const isDetective = myRole?.role === PlayerRole.DETECTIVE;
  const amIAlive = session?.players.find(p => p.id === playerId)?.isAlive ?? true;
  const alivePlayers = session?.players.filter(p => p.isAlive) || [];
  const currentPhase = session?.phase || GamePhase.LOBBY;
  const phaseInfo = phaseData?.info || PHASE_INFO[currentPhase];

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

  // Game Over
  if (gameOver || session.isGameOver) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 phase-result">
        <div className="text-center animate-fade-in max-w-sm w-full">
          <div className="text-7xl mb-4">🏁</div>
          <h1 className="text-3xl font-bold mb-2">انتهت اللعبة!</h1>
          <div className={`text-2xl font-bold mb-6 ${gameOver?.winner === 'MAFIA_WIN' ? 'text-doubt-accent' : 'text-green-400'}`}>
            {gameOver?.winnerName} فازوا!
          </div>
          <div className="space-y-1.5 mb-6">
            {(gameOver?.players || session.players).map(p => (
              <div key={p.id} className={`flex items-center gap-2 p-2 rounded-lg ${p.isAlive ? 'bg-white/10' : 'bg-white/5 opacity-50'}`}>
                <span>{roleIcons[p.role || ''] || '👤'}</span>
                <span className="flex-1 text-sm">{p.name}</span>
                <span className={`text-xs ${p.role === 'MAFIA' ? 'text-doubt-accent' : 'text-green-400'}`}>{roleNames[p.role || '']}</span>
              </div>
            ))}
          </div>
          <button onClick={() => router.push('/')} className="w-full py-3 bg-doubt-accent rounded-xl font-bold">🏠 العودة</button>
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
    <div className={`min-h-screen flex flex-col phase-transition ${phaseBackground}`}>
      <CinematicOverlay state={overlayState} />
      {currentPhase === GamePhase.NIGHT && <div className="fixed inset-0 cinema-vignette-red pointer-events-none z-10" />}
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
          {!amIAlive && <span className="text-xs text-doubt-muted bg-white/10 px-2 py-1 rounded-full">💀 متفرج</span>}
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

      {/* Detective notification */}
      {detectiveResult && (
        <div className={`mx-3 mt-2 px-4 py-2 rounded-xl text-sm font-bold text-center animate-fade-in ${
          detectiveResult.isMafia ? 'bg-red-900/90 text-red-200' : 'bg-purple-900/90 text-purple-200'
        }`}>
          🕵️ {detectiveResult.targetName}: {detectiveResult.isMafia ? '⚠️ عضو عصابة!' : '✅ بريء'}
        </div>
      )}

      {/* Detective Log */}
      {showDetectiveLog && (
        <div className="mx-3 mt-2 bg-black/90 border border-purple-500/30 rounded-xl p-3 animate-fade-in">
          <h4 className="text-purple-400 text-xs font-bold mb-2">🕵️ سجل الفحوصات</h4>
          {detectiveHistory.map((r, i) => (
            <div key={i} className={`text-xs p-1.5 rounded mb-1 ${r.isMafia ? 'bg-red-500/10 text-red-300' : 'bg-green-500/10 text-green-300'}`}>
              {r.targetName}: {r.isMafia ? '⚠️ مافيا' : '✅ بريء'}
            </div>
          ))}
        </div>
      )}

      {/* Main Content */}
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
                    <p className="text-doubt-accent text-xs font-bold mb-2 text-center">🔴 قناة سرية</p>
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
              <div className="text-center py-16 animate-fade-in">
                <div className="text-6xl mb-4">🌙</div>
                <p className="text-doubt-muted text-lg">{amIAlive ? '😴 نم بسلام...' : '👻 أنت متفرج'}</p>
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

        {/* DISCUSSION - Chat */}
        {currentPhase === GamePhase.DISCUSSION && (
          <div className="p-3 space-y-2">
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
        )}

        {/* VOTING */}
        {currentPhase === GamePhase.VOTING && (
          <div className="p-4">
            {amIAlive && votingOpen ? (
              <div className="max-w-sm mx-auto animate-fade-in">
                <h3 className="text-doubt-gold text-center text-sm font-bold mb-4">🗳️ صوّت لطرد المشبوه</h3>
                {voteUpdate && (
                  <div className="text-center mb-3">
                    <span className="text-xs text-doubt-muted">صوّت {voteUpdate.totalVotes} من {voteUpdate.totalEligible}</span>
                  </div>
                )}
                <div className="space-y-2">
                  {alivePlayers.filter(p => p.id !== playerId).map(p => (
                    <button key={p.id} onClick={() => handleVote(p.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                        myVote === p.id ? 'bg-doubt-gold/30 border-2 border-doubt-gold' : 'bg-white/5 border-2 border-transparent hover:bg-white/10'
                      }`}>
                      <span>{myVote === p.id ? '✋' : '👤'}</span>
                      <span className="flex-1 text-right">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-doubt-muted">{!amIAlive ? '👻 متفرج' : !votingOpen ? '🔒 التصويت مغلق' : ''}</p>
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

      {/* Bottom Chat Input - WhatsApp style */}
      {currentPhase === GamePhase.DISCUSSION && amIAlive && (
        <div className="border-t border-white/10 bg-black/50 p-3 shrink-0">
          <div className="flex gap-2 max-w-md mx-auto">
            <input type="text" value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={chatOpen ? 'اكتب رسالة...' : '🔒 الشات مغلق'}
              disabled={!chatOpen}
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-3 text-sm
                         placeholder:text-doubt-muted/50 focus:outline-none focus:border-doubt-gold/30
                         disabled:opacity-30" dir="rtl" />
            <button onClick={handleSend} disabled={!chatOpen || !chatInput.trim()}
              className="w-12 h-12 bg-doubt-gold/20 text-doubt-gold rounded-full flex items-center justify-center
                         text-lg transition-all disabled:opacity-30 hover:bg-doubt-gold/30">
              ↑
            </button>
          </div>
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
