'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ServerToClientEvents, ClientToServerEvents, GameSession, PhaseChangeData,
  Player, RoleAssignment, NightTargetData, MorningResult, GameOverData,
  VoteUpdateData, VoteResultData, ChatMessage, MafiaChatMessage, DetectiveResult,
  NightReadiness, AudioCuePayload, BaseResponse, SessionResponse,
} from '@/types/game';
import { audioDirector, type SFXKey } from '@/lib/audioDirector';

const SOCKET_URL = typeof window !== 'undefined'
  ? (process.env.NODE_ENV === 'production' ? '' : `http://${window.location.hostname}:3001`)
  : '';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSocket() {
  const socketRef = useRef<GameSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [session, setSession] = useState<GameSession | null>(null);
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket: GameSocket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => { setIsConnected(true); setError(null); });
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('session:updated', (s: GameSession) => setSession(s));

    socket.on('phase:changed', (data: PhaseChangeData) => {
      setPhaseData(data);
      if (data.phase === 'LOBBY') {
        setGameOver(null); setMyRole(null); setMorningResult(null);
        setVoteResult(null); setVoteUpdate(null); setMessages([]);
        setMafiaMessages([]); setNightReadiness(null); setDetectiveHistory([]);
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
      socketRef.current.emit('session:create', (r: SessionResponse) => {
        if (r.success && r.session) {
          setSession(r.session); setPlayerId(r.playerId || null); setIsHost(true); setError(null); resolve(true);
        } else { setError(r.error || 'فشل'); resolve(false); }
      });
    });
  }, []);

  const joinSession = useCallback(async (code: string, playerName: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current) { setError('غير متصل'); resolve(false); return; }
      socketRef.current.emit('session:join', code, playerName, (r: SessionResponse) => {
        if (r.success && r.session) {
          setSession(r.session); setPlayerId(r.playerId || null); setIsHost(false); setError(null); resolve(true);
        } else { setError(r.error || 'فشل'); resolve(false); }
      });
    });
  }, []);

  return {
    isConnected, session, playerId, isHost, myRole, phaseData,
    nightTarget, morningResult, voteUpdate, voteResult, messages,
    mafiaMessages, detectiveResult, detectiveHistory, doctorConfirm, detectiveConfirm,
    chatOpen, votingOpen, nightReadiness, gameOver, error,
    createSession, joinSession,
    initAudio: useCallback(async () => {
      await audioDirector.init();
      await audioDirector.resume();
      audioDirector.playBackground();
    }, []),
    toggleMute: useCallback(() => audioDirector.toggleMute(), []),
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
  };
}
