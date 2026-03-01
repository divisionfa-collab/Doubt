'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ServerToClientEvents, ClientToServerEvents, GameSession, PhaseChangeData,
  Player, RoleAssignment, NightTargetData, MorningResult, GameOverData,
  VoteUpdateData, VoteResultData, ChatMessage, MafiaChatMessage, DetectiveResult,
  NightReadiness, AudioCuePayload, BaseResponse, SessionResponse,
  PostGameStartData, PostGameUpdateData,
} from '@/types/game';
import { audioDirector, type SFXKey } from '@/lib/audioDirector';

const SOCKET_URL = typeof window !== 'undefined'
  ? (process.env.NODE_ENV === 'production' ? '' : `http://${window.location.hostname}:3001`)
  : '';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ============================================
// EO-A01-HOTFIX: Stable Identity System
// player_id في localStorage — لا يُمسح أبداً تلقائياً
// ============================================

const PID_KEY = 'doubt_player_id';
const HOST_PID_KEY = 'doubt_host_id';
const SESSION_KEY = 'doubt_session';

function getOrCreatePlayerId(forHost = false): string {
  if (typeof window === 'undefined') return '';
  const key = forHost ? HOST_PID_KEY : PID_KEY;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function saveSession(code: string, name: string, isHost: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code, name, isHost }));
}

function loadSession(): { code: string; name: string; isHost: boolean } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearSessionOnly() {
  if (typeof window !== 'undefined') localStorage.removeItem(SESSION_KEY);
}

// Full logout — only called on explicit "خروج نهائي"
function fullLogout() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PID_KEY);
  localStorage.removeItem(HOST_PID_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function useSocket() {
  const socketRef = useRef<GameSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [session, setSession] = useState<GameSession | null>(null);
  const sessionRef = useRef<GameSession | null>(null); // for reconnect closure
  const reconnectingRef = useRef(false); // prevent double auto-reconnect
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [myRole, setMyRole] = useState<RoleAssignment | null>(null);
  const [phaseData, setPhaseData] = useState<PhaseChangeData | null>(null);
  const [nightTarget, setNightTarget] = useState<NightTargetData | null>(null);
  const [morningResult, setMorningResult] = useState<MorningResult | null>(null);
  const [voteUpdate, setVoteUpdate] = useState<VoteUpdateData | null>(null);
  const [voteResult, setVoteResult] = useState<VoteResultData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mafiaMessages, setMafiaMessages] = useState<MafiaChatMessage[]>([]);
  const [detectiveResult, setDetectiveResult] = useState<DetectiveResult | null>(null);
  const [detectiveHistory, setDetectiveHistory] = useState<DetectiveResult[]>([]);
  const [doctorConfirm, setDoctorConfirm] = useState<string | null>(null);
  const [detectiveConfirm, setDetectiveConfirm] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [votingOpen, setVotingOpen] = useState(false);
  const [nightReadiness, setNightReadiness] = useState<NightReadiness | null>(null);
  const [gameOver, setGameOver] = useState<GameOverData | null>(null);
  const [postGameStart, setPostGameStart] = useState<PostGameStartData | null>(null);
  const [postGameUpdate, setPostGameUpdate] = useState<PostGameUpdateData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket: GameSocket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true); setError(null);

      // EO-A01-HOTFIX: Auto-reconnect from saved session
      if (sessionRef.current) return;

      const saved = loadSession();
      if (!saved || reconnectingRef.current) return;

      reconnectingRef.current = true;
      const pid = getOrCreatePlayerId(saved.isHost);
      if (saved.isHost) {
        (socket as any).emit('session:create', pid, (r: any) => {
          reconnectingRef.current = false;
          if (r.success && r.session) {
            setSession(r.session); setPlayerId(pid); setIsHost(true);
            sessionRef.current = r.session;
          } else {
            clearSessionOnly();
          }
        });
      } else {
        (socket as any).emit('session:join', saved.code, saved.name, pid, (r: any) => {
          reconnectingRef.current = false;
          if (r.success && r.session) {
            setSession(r.session); setPlayerId(pid); setIsHost(false);
            sessionRef.current = r.session;
          } else {
            clearSessionOnly();
          }
        });
      }
    });
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('session:updated', (s: GameSession) => { setSession(s); sessionRef.current = s; });

    socket.on('phase:changed', (data: PhaseChangeData) => {
      setPhaseData(data);
      if (data.phase === 'LOBBY') {
        setGameOver(null); setMyRole(null); setMorningResult(null);
        setVoteResult(null); setVoteUpdate(null); setMessages([]);
        setMafiaMessages([]); setNightReadiness(null); setDetectiveHistory([]);
        setPostGameStart(null); setPostGameUpdate(null);
      }
      if (data.phase === 'NIGHT') {
        setNightTarget(null); setMorningResult(null); setVoteUpdate(null);
        setVoteResult(null); setMafiaMessages([]); setDetectiveResult(null);
        setDoctorConfirm(null); setDetectiveConfirm(null); setNightReadiness(null);
      }
      if (data.phase === 'DISCUSSION') setMessages([]);
      if (data.phase === 'VOTING') { setVoteUpdate(null); setVoteResult(null); }
    });

    socket.on('player:joined', (p: Player) => console.log(`joined ${p.name}`));
    socket.on('player:left', (id: string) => console.log(`left ${id}`));
    socket.on('role:assigned', (data: RoleAssignment) => setMyRole(data));
    socket.on('night:target_selected', (data: NightTargetData) => setNightTarget(data));
    socket.on('night:doctor_selected', (data: { targetName: string }) => setDoctorConfirm(data.targetName));
    socket.on('night:detective_selected', (data: { targetName: string }) => setDetectiveConfirm(data.targetName));
    socket.on('morning:kill_result', (data: MorningResult) => setMorningResult(data));

    socket.on('detective:result', (data: DetectiveResult) => {
      setDetectiveResult(data);
      setDetectiveHistory((prev: DetectiveResult[]) => [...prev, data]);
      setTimeout(() => setDetectiveResult(null), 5000);
    });

    socket.on('mafia:message', (msg: MafiaChatMessage) => setMafiaMessages((prev: MafiaChatMessage[]) => [...prev, msg]));
    socket.on('vote:update', (data: VoteUpdateData) => setVoteUpdate(data));
    socket.on('vote:result', (data: VoteResultData) => setVoteResult(data));
    socket.on('chat:message', (msg: ChatMessage) => setMessages((prev: ChatMessage[]) => [...prev, msg]));
    socket.on('chat:state', (data: { open: boolean }) => setChatOpen(data.open));
    socket.on('voting:state', (data: { open: boolean }) => setVotingOpen(data.open));
    socket.on('night:readiness', (data: NightReadiness) => setNightReadiness(data));

    // Audio cues from server
    socket.on('audio:cue', (cue: AudioCuePayload) => {
      const delay = cue.delayMs || 0;
      const execute = () => {
        audioDirector.executeCue({
          type: cue.type as any,
          file: cue.file as SFXKey | undefined,
          duckTo: cue.duckTo,
        });
        // Trigger execution blood overlay for pistol shots (vote elimination)
        if (cue.file && ['pistol1', 'pistol2', 'pistol3'].includes(cue.file)) {
          window.dispatchEvent(new Event('execution_blood'));
        }
        // Trigger night blood overlay for cry (night kill - players are "sleeping")
        if (cue.file === 'cry') {
          window.dispatchEvent(new Event('night_kill_effect'));
        }
      };
      if (delay > 0) setTimeout(execute, delay);
      else execute();
    });
    socket.on('game:over', (data: GameOverData) => setGameOver(data));
    socket.on('post_game:start', (data: PostGameStartData) => setPostGameStart(data));
    socket.on('post_game:update', (data: PostGameUpdateData) => setPostGameUpdate(data));
    socket.on('error', (msg: string) => setError(msg));

    return () => { socket.disconnect(); };
  }, []);

  const emitCb = useCallback((event: string, ...args: unknown[]): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current) { setError('غير متصل'); resolve(false); return; }
      const a = [...args, (r: BaseResponse) => {
        if (r.success) { setError(null); resolve(true); }
        else { setError(r.error || 'فشل'); resolve(false); }
      }];
      (socketRef.current as any).emit(event, ...a);
    });
  }, []);

  const createSession = useCallback(async (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current) { setError('غير متصل'); resolve(false); return; }
      const pid = getOrCreatePlayerId(true);
      (socketRef.current as any).emit('session:create', pid, (r: SessionResponse) => {
        if (r.success && r.session) {
          setSession(r.session); setPlayerId(r.playerId || pid); setIsHost(true); setError(null);
          sessionRef.current = r.session;
          saveSession(r.session.code, '__HOST__', true);
          resolve(true);
        } else { setError(r.error || 'فشل'); resolve(false); }
      });
    });
  }, []);

  const joinSession = useCallback(async (code: string, playerName: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current) { setError('غير متصل'); resolve(false); return; }
      const pid = getOrCreatePlayerId();
      (socketRef.current as any).emit('session:join', code, playerName, pid, (r: SessionResponse) => {
        if (r.success && r.session) {
          setSession(r.session); setPlayerId(r.playerId || pid); setIsHost(false); setError(null);
          sessionRef.current = r.session;
          saveSession(code, playerName, false);
          resolve(true);
        } else { setError(r.error || 'فشل'); resolve(false); }
      });
    });
  }, []);

  // EO-L01b: Toggle join open/closed
  const toggleJoinOpen = useCallback(async (): Promise<boolean> => {
    if (!socketRef.current) return false;
    return new Promise(resolve => {
      (socketRef.current as any).emit('session:toggle_join', (res: any) => {
        if (res.error) {
          setError(res.error);
          setTimeout(() => setError(null), 3000);
        }
        resolve(res.success || false);
      });
    });
  }, []);

  // EO-L01: Lock session code
  const lockSessionCode = useCallback(async (code: string): Promise<boolean> => {
    if (!socketRef.current) return false;
    return new Promise(resolve => {
      (socketRef.current as any).emit('session:lock_code', code, (res: any) => {
        if (res.error) {
          setError(res.error);
          setTimeout(() => setError(null), 3000);
        }
        resolve(res.success || false);
      });
    });
  }, []);

  return {
    isConnected, session, playerId, isHost, myRole, phaseData,
    nightTarget, morningResult, voteUpdate, voteResult, messages,
    mafiaMessages, detectiveResult, detectiveHistory, doctorConfirm, detectiveConfirm,
    chatOpen, votingOpen, nightReadiness, gameOver, postGameStart, postGameUpdate, error,
    createSession, joinSession, lockSessionCode, toggleJoinOpen,
    clearSavedSession: useCallback(() => { clearSessionOnly(); setSession(null); sessionRef.current = null; }, []),
    initAudio: useCallback(async () => {
      await audioDirector.init();
      await audioDirector.resume();
      audioDirector.playBackground();
    }, []),
    toggleMute: useCallback(() => audioDirector.toggleMute(), []),
    startAmbient: useCallback((key: string, vol?: number, fade?: number) => audioDirector.startAmbient(key as any, vol, fade), []),
    stopAmbient: useCallback((fade?: number) => audioDirector.stopAmbient(fade), []),
    hostStartGame: useCallback(() => emitCb('host:start_game'), [emitCb]),
    hostSetPhase: useCallback((p: string) => emitCb('host:set_phase', p), [emitCb]),
    hostOpenChat: useCallback(() => emitCb('host:open_chat'), [emitCb]),
    hostCloseChat: useCallback(() => emitCb('host:close_chat'), [emitCb]),
    hostOpenVoting: useCallback(() => emitCb('host:open_voting'), [emitCb]),
    hostCloseVoting: useCallback(() => emitCb('host:close_voting'), [emitCb]),
    hostResolveNight: useCallback(() => emitCb('host:resolve_night'), [emitCb]),
    hostSendPrompt: useCallback((t: string) => emitCb('host:send_prompt', t), [emitCb]),
    hostRestartGame: useCallback(() => emitCb('host:restart_game'), [emitCb]),
    selectNightTarget: useCallback((t: string) => emitCb('night:select_target', t), [emitCb]),
    doctorProtect: useCallback((t: string) => emitCb('night:doctor_protect', t), [emitCb]),
    detectiveCheck: useCallback((t: string) => emitCb('night:detective_check', t), [emitCb]),
    sendMafiaChat: useCallback((t: string) => emitCb('mafia:chat', t), [emitCb]),
    castVote: useCallback((t: string) => emitCb('vote:cast', t), [emitCb]),
    sendMessage: useCallback((t: string) => emitCb('chat:send', t), [emitCb]),
    postGameRespond: useCallback((choice: 'continue' | 'exit') => emitCb('post_game:respond', choice), [emitCb]),
    hostStartNewRound: useCallback(() => emitCb('host:start_new_round'), [emitCb]),
  };
}
