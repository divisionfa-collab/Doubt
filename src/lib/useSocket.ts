'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  GameSession,
  PhaseChangeData,
  TimerData,
  Player,
  RoleAssignment,
  NightTargetData,
  MorningResult,
  GameOverData,
  VoteUpdateData,
  VoteResultData,
  ChatMessage,
  MafiaChatMessage,
  DetectiveResult,
  BaseResponse,
  SessionResponse,
} from '@/types/game';

const SOCKET_URL = typeof window !== 'undefined'
  ? (process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:3001')
  : 'http://localhost:3001';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSocket() {
  const socketRef = useRef<GameSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [session, setSession] = useState<GameSession | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<RoleAssignment | null>(null);
  const [phaseData, setPhaseData] = useState<PhaseChangeData | null>(null);
  const [timerData, setTimerData] = useState<TimerData | null>(null);
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
  const [gameOver, setGameOver] = useState<GameOverData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket: GameSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => { setIsConnected(true); setError(null); });
    socket.on('disconnect', () => { setIsConnected(false); });
    socket.on('session:updated', (s: GameSession) => setSession(s));

    socket.on('phase:changed', (data: PhaseChangeData) => {
      setPhaseData(data);
      if (data.phase === 'NIGHT') {
        setNightTarget(null);
        setMorningResult(null);
        setVoteUpdate(null);
        setVoteResult(null);
        setMessages([]);
        setMafiaMessages([]);
        setDetectiveResult(null);
        setDoctorConfirm(null);
        setDetectiveConfirm(null);
      }
      if (data.phase === 'DISCUSSION') {
        setMessages([]);
      }
      if (data.phase === 'VOTING') {
        setVoteUpdate(null);
        setVoteResult(null);
      }
    });

    socket.on('timer:tick', (data: TimerData) => setTimerData(data));
    socket.on('player:joined', (p: Player) => console.log(`👤 ${p.name} joined`));
    socket.on('player:left', (id: string) => console.log(`👋 ${id} left`));

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
    socket.on('game:over', (data: GameOverData) => setGameOver(data));
    socket.on('error', (msg: string) => setError(msg));

    return () => { socket.disconnect(); };
  }, []);

  const createSession = useCallback(async (playerName: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current) { setError('غير متصل'); resolve(false); return; }
      socketRef.current.emit('session:create', playerName, (r: SessionResponse) => {
        if (r.success && r.session) { setSession(r.session); setPlayerId(r.playerId || null); setError(null); resolve(true); }
        else { setError(r.error || 'فشل'); resolve(false); }
      });
    });
  }, []);

  const joinSession = useCallback(async (code: string, playerName: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current) { setError('غير متصل'); resolve(false); return; }
      socketRef.current.emit('session:join', code, playerName, (r: SessionResponse) => {
        if (r.success && r.session) { setSession(r.session); setPlayerId(r.playerId || null); setError(null); resolve(true); }
        else { setError(r.error || 'فشل'); resolve(false); }
      });
    });
  }, []);

  const emitSimple = useCallback((event: keyof ClientToServerEvents, arg: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current) { setError('غير متصل'); resolve(false); return; }
      (socketRef.current as any).emit(event, arg, (r: BaseResponse) => {
        if (r.success) { setError(null); resolve(true); }
        else { setError(r.error || 'فشل'); resolve(false); }
      });
    });
  }, []);

  const emitNoArg = useCallback((event: keyof ClientToServerEvents): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current) { setError('غير متصل'); resolve(false); return; }
      (socketRef.current as any).emit(event, (r: BaseResponse) => {
        if (r.success) { setError(null); resolve(true); }
        else { setError(r.error || 'فشل'); resolve(false); }
      });
    });
  }, []);

  return {
    isConnected, session, playerId, myRole, phaseData, timerData,
    nightTarget, morningResult, voteUpdate, voteResult, messages,
    mafiaMessages, detectiveResult, detectiveHistory, doctorConfirm, detectiveConfirm,
    gameOver, error,
    createSession,
    joinSession,
    startGame: useCallback(() => emitNoArg('game:start'), [emitNoArg]),
    selectNightTarget: useCallback((t: string) => emitSimple('night:select_target', t), [emitSimple]),
    doctorProtect: useCallback((t: string) => emitSimple('night:doctor_protect', t), [emitSimple]),
    detectiveCheck: useCallback((t: string) => emitSimple('night:detective_check', t), [emitSimple]),
    sendMafiaChat: useCallback((t: string) => emitSimple('mafia:chat', t), [emitSimple]),
    castVote: useCallback((t: string) => emitSimple('vote:cast', t), [emitSimple]),
    sendMessage: useCallback((t: string) => emitSimple('chat:send', t), [emitSimple]),
  };
}
