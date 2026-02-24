// ============================================
// Doubt Game - Game Engine
// EO-01: Host-Managed Game (No Timers)
// ============================================

import {
  GamePhase,
  GameSession,
  Player,
  PlayerRole,
  WinResult,
  ChatMessage,
  MafiaChatMessage,
  NightActions,
  NightReadiness,
  DetectiveResult,
  AudioCuePayload,
  PhaseChangeData,
  RoleAssignment,
  NightTargetData,
  MorningResult,
  GameOverData,
  VoteUpdateData,
  VoteResultData,
  VoteCount,
  PHASE_INFO,
  MAX_MAFIA_CHAT_LENGTH,
  MAX_MAFIA_MESSAGES,
  getRoleDistribution,
} from '../types/game';

// ============================================
// Helpers
// ============================================

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function emptyNightActions(): NightActions {
  return { mafiaTarget: null, doctorProtect: null, detectiveCheck: null, lastDoctorProtect: null };
}

// ============================================
// Storage
// ============================================

const sessions: Map<string, GameSession> = new Map();
const codeToSessionId: Map<string, string> = new Map();
const playerToSession: Map<string, string> = new Map();

// ============================================
// Callbacks
// ============================================

interface EngineCallbacks {
  onPhaseChange: (sessionId: string, data: PhaseChangeData) => void;
  onSessionUpdated: (sessionId: string, session: GameSession) => void;
  onRoleAssigned: (playerId: string, data: RoleAssignment) => void;
  onNightTargetSelected: (sessionId: string, data: NightTargetData, mafiaOnly: boolean) => void;
  onDoctorSelected: (playerId: string, data: { targetName: string }) => void;
  onDetectiveSelected: (playerId: string, data: { targetName: string }) => void;
  onMorningResult: (sessionId: string, data: MorningResult) => void;
  onDetectiveResult: (playerId: string, data: DetectiveResult) => void;
  onMafiaMessage: (sessionId: string, message: MafiaChatMessage) => void;
  onNightReadiness: (hostId: string, data: NightReadiness) => void;
  onVoteUpdate: (sessionId: string, data: VoteUpdateData) => void;
  onVoteResult: (sessionId: string, data: VoteResultData) => void;
  onChatMessage: (sessionId: string, message: ChatMessage) => void;
  onChatState: (sessionId: string, open: boolean) => void;
  onVotingState: (sessionId: string, open: boolean) => void;
  onGameOver: (sessionId: string, data: GameOverData) => void;
  onAudioCue: (sessionId: string, cue: AudioCuePayload) => void;
}

let callbacks: EngineCallbacks | null = null;

export function setCallbacks(cb: EngineCallbacks): void {
  callbacks = cb;
}

// ============================================
// Session Management
// ============================================

export function createSession(hostId: string): { session: GameSession } {
  const sessionId = generateId();
  let code = generateCode();
  while (codeToSessionId.has(code)) code = generateCode();

  const session: GameSession = {
    id: sessionId, code, hostId,
    players: [],
    phase: GamePhase.LOBBY, round: 0,
    isStarted: false, isGameOver: false, winResult: null,
    nightActions: emptyNightActions(),
    lastKilled: null, lastKilledName: null,
    chatOpen: false, messages: [],
    mafiaMessages: [], mafiaMsgCount: {},
    votingOpen: false, votes: {}, voteResult: null,
    createdAt: Date.now(),
  };

  sessions.set(sessionId, session);
  codeToSessionId.set(code, sessionId);
  playerToSession.set(hostId, sessionId);
  console.log(`🎮 Session created: ${code} (host: ${hostId})`);
  return { session };
}

export function joinSession(code: string, playerName: string, playerId: string): { session: GameSession; player: Player } | { error: string } {
  const sessionId = codeToSessionId.get(code.toUpperCase());
  if (!sessionId) return { error: 'كود الجلسة غير صحيح' };

  const session = sessions.get(sessionId);
  if (!session) return { error: 'الجلسة غير موجودة' };
  if (session.isStarted && !session.isGameOver) return { error: 'اللعبة جارية' };
  if (session.players.length >= 20) return { error: 'الجلسة ممتلئة' };
  if (session.players.some(p => p.name === playerName)) return { error: 'الاسم مستخدم' };

  const player: Player = {
    id: playerId, name: playerName, role: null,
    isAlive: true, isConnected: true, joinedAt: Date.now(),
  };

  session.players.push(player);
  playerToSession.set(playerId, sessionId);
  console.log(`👤 ${playerName} joined ${code} (${session.players.length} players)`);
  return { session, player };
}

export function leaveSession(playerId: string): { sessionId: string; session: GameSession | null } | null {
  const sessionId = playerToSession.get(playerId);
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  // Host left - destroy session
  if (playerId === session.hostId) {
    destroySession(sessionId);
    return { sessionId, session: null };
  }

  session.players = session.players.filter(p => p.id !== playerId);
  playerToSession.delete(playerId);

  if (session.isStarted && !session.isGameOver) {
    const winCheck = checkWinCondition(session);
    if (winCheck) endGame(sessionId, winCheck);
  }

  return { sessionId, session };
}

function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  codeToSessionId.delete(session.code);
  playerToSession.delete(session.hostId);
  session.players.forEach(p => playerToSession.delete(p.id));
  sessions.delete(sessionId);
}

// ============================================
// Host Commands
// ============================================

function verifyHost(hostId: string): { session: GameSession; sessionId: string } | { error: string } {
  const sessionId = playerToSession.get(hostId);
  if (!sessionId) return { error: 'لست في جلسة' };
  const session = sessions.get(sessionId);
  if (!session) return { error: 'جلسة غير موجودة' };
  if (session.hostId !== hostId) return { error: 'لست المدير' };
  return { session, sessionId };
}

export function startGame(hostId: string): { success: boolean; error?: string } {
  const result = verifyHost(hostId);
  if ('error' in result) return { success: false, error: result.error };
  const { session, sessionId } = result;

  if (session.isStarted && !session.isGameOver) return { success: false, error: 'بدأت بالفعل' };
  if (session.players.length < 2) return { success: false, error: 'يجب لاعبان على الأقل' };

  // Reset everything for new game (or first game)
  session.isStarted = true;
  session.isGameOver = false;
  session.winResult = null;
  session.round = 1;
  session.messages = [];
  session.mafiaMessages = [];
  session.mafiaMsgCount = {};
  session.votes = {};
  session.voteResult = null;
  session.nightActions = emptyNightActions();
  session.lastKilled = null;
  session.lastKilledName = null;
  session.chatOpen = false;
  session.votingOpen = false;

  // Revive all players for new round
  session.players.forEach(p => { p.isAlive = true; p.role = null; });

  console.log(`\n🚀 Game started: ${session.code} (${session.players.length} players)`);

  assignRoles(session);
  setPhase(sessionId, GamePhase.NIGHT);
  return { success: true };
}

export function hostSetPhase(hostId: string, phaseStr: string): { success: boolean; error?: string } {
  const result = verifyHost(hostId);
  if ('error' in result) return { success: false, error: result.error };
  const { session, sessionId } = result;

  if (!session.isStarted) return { success: false, error: 'اللعبة لم تبدأ' };

  const phase = phaseStr as GamePhase;
  if (!Object.values(GamePhase).includes(phase)) return { success: false, error: 'مرحلة غير صالحة' };

  if (phase === GamePhase.NIGHT) session.round++;
  setPhase(sessionId, phase);
  return { success: true };
}

export function hostOpenChat(hostId: string): { success: boolean; error?: string } {
  const result = verifyHost(hostId);
  if ('error' in result) return { success: false, error: result.error };
  const { session, sessionId } = result;

  session.chatOpen = true;
  if (callbacks) callbacks.onChatState(sessionId, true);
  console.log(`💬 [${session.code}] Chat OPENED`);
  return { success: true };
}

export function hostCloseChat(hostId: string): { success: boolean; error?: string } {
  const result = verifyHost(hostId);
  if ('error' in result) return { success: false, error: result.error };
  const { session, sessionId } = result;

  session.chatOpen = false;
  if (callbacks) callbacks.onChatState(sessionId, false);
  console.log(`🔇 [${session.code}] Chat CLOSED`);
  return { success: true };
}

export function hostOpenVoting(hostId: string): { success: boolean; error?: string } {
  const result = verifyHost(hostId);
  if ('error' in result) return { success: false, error: result.error };
  const { session, sessionId } = result;

  session.votingOpen = true;
  session.votes = {};
  session.voteResult = null;
  if (callbacks) callbacks.onVotingState(sessionId, true);
  console.log(`🗳️ [${session.code}] Voting OPENED`);
  return { success: true };
}

export function hostCloseVoting(hostId: string): { success: boolean; error?: string } {
  const result = verifyHost(hostId);
  if ('error' in result) return { success: false, error: result.error };
  const { session, sessionId } = result;

  session.votingOpen = false;
  if (callbacks) callbacks.onVotingState(sessionId, false);
  resolveVotes(sessionId);
  console.log(`🔒 [${session.code}] Voting CLOSED`);
  return { success: true };
}

export function hostResolveNight(hostId: string): { success: boolean; error?: string } {
  const result = verifyHost(hostId);
  if ('error' in result) return { success: false, error: result.error };
  const { sessionId } = result;

  executeNightKill(sessionId);
  return { success: true };
}

export function hostSendPrompt(hostId: string, text: string): { success: boolean; error?: string } {
  const result = verifyHost(hostId);
  if ('error' in result) return { success: false, error: result.error };
  const { session, sessionId } = result;

  const cleanText = text.trim();
  if (!cleanText) return { success: false, error: 'رسالة فارغة' };

  const message: ChatMessage = {
    id: generateId(),
    playerId: session.hostId,
    playerName: '🎮 المدير',
    text: cleanText,
    isHost: true,
    timestamp: Date.now(),
  };

  session.messages.push(message);
  if (callbacks) callbacks.onChatMessage(sessionId, message);
  return { success: true };
}

export function hostRestartGame(hostId: string): { success: boolean; error?: string } {
  const result = verifyHost(hostId);
  if ('error' in result) return { success: false, error: result.error };
  const { session, sessionId } = result;

  if (!session.isGameOver) return { success: false, error: 'اللعبة لم تنتهِ بعد' };

  session.isStarted = false;
  session.isGameOver = false;
  session.winResult = null;
  session.phase = GamePhase.LOBBY;
  session.round = 0;
  session.players.forEach(p => { p.isAlive = true; p.role = null; });
  session.messages = [];
  session.mafiaMessages = [];
  session.mafiaMsgCount = {};
  session.votes = {};
  session.voteResult = null;
  session.nightActions = emptyNightActions();
  session.lastKilled = null;
  session.lastKilledName = null;
  session.chatOpen = false;
  session.votingOpen = false;

  console.log(`🔄 [${session.code}] Game reset to lobby (${session.players.length} players)`);

  if (callbacks) {
    callbacks.onPhaseChange(sessionId, { phase: GamePhase.LOBBY, round: 0, info: PHASE_INFO[GamePhase.LOBBY] });
    callbacks.onSessionUpdated(sessionId, session);
  }
  return { success: true };
}

// ============================================
// Role Assignment
// ============================================

function assignRoles(session: GameSession): void {
  const roles = getRoleDistribution(session.players.length);
  const shuffledRoles = shuffle(roles);

  session.players.forEach((player, index) => {
    player.role = shuffledRoles[index];
    player.isAlive = true;
  });

  const mafiaNames = session.players.filter(p => p.role === PlayerRole.MAFIA).map(p => p.name);

  session.players.forEach(player => {
    if (callbacks) {
      callbacks.onRoleAssigned(player.id, {
        role: player.role!,
        teammates: player.role === PlayerRole.MAFIA ? mafiaNames.filter(n => n !== player.name) : [],
      });
    }
  });

  // إرسال كل الأدوار للـ Host
  if (callbacks) {
    const allRoles = session.players.map(p => ({ name: p.name, role: p.role! }));
    callbacks.onRoleAssigned(session.hostId, {
      role: PlayerRole.CITIZEN, // dummy
      teammates: allRoles.map(r => `${r.name}:${r.role}`),
    });
  }

  const roleLog = session.players.map(p => {
    const icons: Record<string, string> = { MAFIA: '🔪', CITIZEN: '🏘️', DOCTOR: '🩺', DETECTIVE: '🕵️' };
    return `${icons[p.role!] || '?'} ${p.name}`;
  }).join(' | ');
  console.log(`🎭 Roles: ${roleLog}`);
}

// ============================================
// Phase Management (No Timers)
// ============================================

function setPhase(sessionId: string, phase: GamePhase): void {
  const session = sessions.get(sessionId);
  if (!session || session.isGameOver) return;

  session.phase = phase;

  if (phase === GamePhase.NIGHT) {
    const lastProtect = session.nightActions.lastDoctorProtect;
    session.nightActions = emptyNightActions();
    session.nightActions.lastDoctorProtect = lastProtect;
    session.voteResult = null;
    session.mafiaMessages = [];
    session.mafiaMsgCount = {};
    session.chatOpen = false;
    session.votingOpen = false;
  }
  if (phase === GamePhase.DISCUSSION) {
    session.messages = [];
    session.chatOpen = true;
  }
  if (phase === GamePhase.VOTING) {
    session.votes = {};
    session.voteResult = null;
    session.votingOpen = true;
    session.chatOpen = false;
  }
  if (phase === GamePhase.RESULT) {
    session.chatOpen = false;
    session.votingOpen = false;
  }

  const info = PHASE_INFO[phase];
  console.log(`${info.icon} [${session.code}] → ${info.name} R${session.round}`);

  if (callbacks) {
    callbacks.onPhaseChange(sessionId, { phase, round: session.round, info });
    // Always sync chat and voting state with clients on phase change
    callbacks.onChatState(sessionId, session.chatOpen);
    callbacks.onVotingState(sessionId, session.votingOpen);
    callbacks.onSessionUpdated(sessionId, session);
  }

  // Send initial night readiness to host
  if (phase === GamePhase.NIGHT) sendNightReadiness(sessionId);
}

// ============================================
// Night Readiness (Host-only status)
// ============================================

function sendNightReadiness(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session || !callbacks) return;

  const alivePlayers = session.players.filter(p => p.isAlive);
  const hasMafia = alivePlayers.some(p => p.role === PlayerRole.MAFIA);
  const hasDoctor = alivePlayers.some(p => p.role === PlayerRole.DOCTOR);
  const hasDetective = alivePlayers.some(p => p.role === PlayerRole.DETECTIVE);

  const mafiaReady = !hasMafia || session.nightActions.mafiaTarget !== null;
  const doctorReady = !hasDoctor || session.nightActions.doctorProtect !== null;
  const detectiveReady = !hasDetective || session.nightActions.detectiveCheck !== null;

  const data: NightReadiness = {
    mafiaReady, doctorReady, detectiveReady,
    hasMafia, hasDoctor, hasDetective,
    allReady: mafiaReady && doctorReady && detectiveReady,
  };

  callbacks.onNightReadiness(session.hostId, data);
}

// ============================================
// Night Actions
// ============================================

export function selectNightTarget(playerId: string, targetId: string): { success: boolean; error?: string } {
  const sessionId = playerToSession.get(playerId);
  if (!sessionId) return { success: false, error: 'لست في جلسة' };
  const session = sessions.get(sessionId);
  if (!session) return { success: false, error: 'جلسة غير موجودة' };
  if (session.phase !== GamePhase.NIGHT) return { success: false, error: 'ليس وقت الليل' };

  const player = session.players.find(p => p.id === playerId);
  if (!player || player.role !== PlayerRole.MAFIA || !player.isAlive) return { success: false, error: 'غير مسموح' };

  const target = session.players.find(p => p.id === targetId && p.isAlive && p.role !== PlayerRole.MAFIA);
  if (!target) return { success: false, error: 'هدف غير صالح' };

  session.nightActions.mafiaTarget = targetId;
  if (callbacks) callbacks.onNightTargetSelected(sessionId, { targetId: target.id, targetName: target.name, selectedBy: player.name }, true);
  sendNightReadiness(sessionId);
  return { success: true };
}

export function doctorProtect(playerId: string, targetId: string): { success: boolean; error?: string } {
  const sessionId = playerToSession.get(playerId);
  if (!sessionId) return { success: false, error: 'لست في جلسة' };
  const session = sessions.get(sessionId);
  if (!session || session.phase !== GamePhase.NIGHT) return { success: false, error: 'ليس وقت الليل' };

  const player = session.players.find(p => p.id === playerId);
  if (!player || player.role !== PlayerRole.DOCTOR || !player.isAlive) return { success: false, error: 'غير مسموح' };

  const target = session.players.find(p => p.id === targetId && p.isAlive);
  if (!target) return { success: false, error: 'هدف غير صالح' };
  if (session.nightActions.lastDoctorProtect === targetId) return { success: false, error: 'لا يمكن حماية نفس الشخص ليلتين' };

  session.nightActions.doctorProtect = targetId;
  if (callbacks) callbacks.onDoctorSelected(playerId, { targetName: target.name });
  sendNightReadiness(sessionId);
  return { success: true };
}

export function detectiveCheck(playerId: string, targetId: string): { success: boolean; error?: string } {
  const sessionId = playerToSession.get(playerId);
  if (!sessionId) return { success: false, error: 'لست في جلسة' };
  const session = sessions.get(sessionId);
  if (!session || session.phase !== GamePhase.NIGHT) return { success: false, error: 'ليس وقت الليل' };

  const player = session.players.find(p => p.id === playerId);
  if (!player || player.role !== PlayerRole.DETECTIVE || !player.isAlive) return { success: false, error: 'غير مسموح' };

  const target = session.players.find(p => p.id === targetId && p.isAlive && p.id !== playerId);
  if (!target) return { success: false, error: 'هدف غير صالح' };

  session.nightActions.detectiveCheck = targetId;
  if (callbacks) callbacks.onDetectiveSelected(playerId, { targetName: target.name });
  sendNightReadiness(sessionId);
  return { success: true };
}

export function sendMafiaChat(playerId: string, text: string): { success: boolean; error?: string } {
  const sessionId = playerToSession.get(playerId);
  if (!sessionId) return { success: false, error: 'لست في جلسة' };
  const session = sessions.get(sessionId);
  if (!session || session.phase !== GamePhase.NIGHT) return { success: false, error: 'ليس وقت الليل' };

  const player = session.players.find(p => p.id === playerId);
  if (!player || player.role !== PlayerRole.MAFIA || !player.isAlive) return { success: false, error: 'غير مسموح' };

  const count = session.mafiaMsgCount[playerId] || 0;
  if (count >= MAX_MAFIA_MESSAGES) return { success: false, error: 'استنفدت رسائلك' };

  const cleanText = text.trim().slice(0, MAX_MAFIA_CHAT_LENGTH);
  if (!cleanText) return { success: false, error: 'رسالة فارغة' };

  const message: MafiaChatMessage = { id: generateId(), playerId: player.id, playerName: player.name, text: cleanText, timestamp: Date.now() };
  session.mafiaMessages.push(message);
  session.mafiaMsgCount[playerId] = count + 1;

  if (callbacks) callbacks.onMafiaMessage(sessionId, message);
  return { success: true };
}

// ============================================
// Night Resolution
// ============================================

function executeNightKill(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  const { mafiaTarget, doctorProtect: protect, detectiveCheck: check } = session.nightActions;
  let killed = false, killedName: string | null = null, killedId: string | null = null;

  if (mafiaTarget) {
    if (protect && mafiaTarget === protect) {
      console.log(`🩺 [${session.code}] Doctor saved the target!`);
    } else {
      const target = session.players.find(p => p.id === mafiaTarget && p.isAlive);
      if (target) { target.isAlive = false; killed = true; killedName = target.name; killedId = target.id; }
    }
  }

  session.lastKilled = killedId;
  session.lastKilledName = killedName;
  session.nightActions.lastDoctorProtect = protect;

  // Detective result (immediate - private to detective)
  if (check) {
    const detective = session.players.find(p => p.role === PlayerRole.DETECTIVE && p.isAlive);
    const target = session.players.find(p => p.id === check);
    if (detective && target && callbacks) {
      callbacks.onDetectiveResult(detective.id, { targetId: target.id, targetName: target.name, isMafia: target.role === PlayerRole.MAFIA });
    }
  }

  // Cinematic sequence: audio + visual WHILE still in NIGHT phase
  // Players hear/see effects while "sleeping" - then morning comes
  if (killed && callbacks) {
    // 0ms: Duck + Cry
    const cryCue: AudioCuePayload = { type: 'duck_and_play', file: 'cry', duckTo: 0.1 };
    callbacks.onAudioCue(sessionId, cryCue);

    // 1.5s: Footsteps
    const walksCue: AudioCuePayload = { type: 'play_only', file: 'walks', delayMs: 1500 };
    callbacks.onAudioCue(sessionId, walksCue);

    // 8s: Transition to morning (after effects finish)
    setTimeout(() => {
      const s = sessions.get(sessionId);
      if (!s || s.isGameOver) return;
      const aliveCount = s.players.filter(p => p.isAlive).length;
      if (callbacks) callbacks.onMorningResult(sessionId, { killed: true, killedName, killedId, aliveCount });
      const winCheck = checkWinCondition(s);
      if (winCheck) { endGame(sessionId, winCheck); return; }
      setPhase(sessionId, GamePhase.MORNING);
    }, 8000);
  } else {
    // No kill - transition immediately
    const aliveCount = session.players.filter(p => p.isAlive).length;
    if (callbacks) callbacks.onMorningResult(sessionId, { killed: false, killedName: null, killedId: null, aliveCount });
    const winCheck = checkWinCondition(session);
    if (winCheck) { endGame(sessionId, winCheck); return; }
    setPhase(sessionId, GamePhase.MORNING);
  }
}

// ============================================
// Chat (Open/Close by Host)
// ============================================

export function sendChatMessage(playerId: string, text: string): { success: boolean; error?: string } {
  const sessionId = playerToSession.get(playerId);
  if (!sessionId) return { success: false, error: 'لست في جلسة' };
  const session = sessions.get(sessionId);
  if (!session) return { success: false, error: 'جلسة غير موجودة' };
  if (!session.chatOpen) return { success: false, error: 'الشات مغلق' };

  const player = session.players.find(p => p.id === playerId);
  if (!player || !player.isAlive) return { success: false, error: 'غير مسموح' };

  const cleanText = text.trim();
  if (!cleanText) return { success: false, error: 'رسالة فارغة' };

  const message: ChatMessage = { id: generateId(), playerId: player.id, playerName: player.name, text: cleanText, isHost: false, timestamp: Date.now() };
  session.messages.push(message);

  if (callbacks) callbacks.onChatMessage(sessionId, message);
  return { success: true };
}

// ============================================
// Voting
// ============================================

export function castVote(playerId: string, targetId: string): { success: boolean; error?: string } {
  const sessionId = playerToSession.get(playerId);
  if (!sessionId) return { success: false, error: 'لست في جلسة' };
  const session = sessions.get(sessionId);
  if (!session) return { success: false, error: 'جلسة غير موجودة' };
  if (!session.votingOpen) return { success: false, error: 'التصويت مغلق' };

  const voter = session.players.find(p => p.id === playerId && p.isAlive);
  if (!voter) return { success: false, error: 'غير مسموح' };

  const target = session.players.find(p => p.id === targetId && p.isAlive && p.id !== playerId);
  if (!target) return { success: false, error: 'هدف غير صالح' };

  session.votes[playerId] = targetId;
  const aliveVoters = session.players.filter(p => p.isAlive);
  const totalVotes = Object.keys(session.votes).length;

  // Calculate vote counts per candidate
  const countMap: Record<string, number> = {};
  Object.values(session.votes).forEach(tid => { countMap[tid] = (countMap[tid] || 0) + 1; });
  const counts = Object.entries(countMap).map(([pid, votes]) => {
    const p = session.players.find(pl => pl.id === pid);
    return { playerId: pid, playerName: p?.name || '?', votes };
  }).sort((a, b) => b.votes - a.votes);

  if (callbacks) {
    callbacks.onVoteUpdate(sessionId, {
      voterId: voter.id, voterName: voter.name,
      totalVotes, totalEligible: aliveVoters.length,
      counts,
    });
  }

  // Auto-resolve when everyone has voted
  if (totalVotes >= aliveVoters.length) {
    session.votingOpen = false;
    if (callbacks) callbacks.onVotingState(sessionId, false);
    resolveVotes(sessionId);
  }

  return { success: true };
}

function resolveVotes(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  const countMap: Record<string, number> = {};
  Object.values(session.votes).forEach(targetId => { countMap[targetId] = (countMap[targetId] || 0) + 1; });

  const voteCounts: VoteCount[] = Object.entries(countMap)
    .map(([pid, count]) => ({ playerId: pid, playerName: session.players.find(p => p.id === pid)?.name || '???', count }))
    .sort((a, b) => b.count - a.count);

  const aliveCount = session.players.filter(p => p.isAlive).length;

  if (voteCounts.length === 0) {
    const r: VoteResultData = { eliminated: false, eliminatedId: null, eliminatedName: null, isTie: false, voteCounts: [], aliveCount };
    session.voteResult = r;
    if (callbacks) callbacks.onVoteResult(sessionId, r);
    return;
  }

  const maxVotes = voteCounts[0].count;
  const topVoted = voteCounts.filter(v => v.count === maxVotes);

  if (topVoted.length > 1) {
    const r: VoteResultData = { eliminated: false, eliminatedId: null, eliminatedName: null, isTie: true, voteCounts, aliveCount };
    session.voteResult = r;
    if (callbacks) callbacks.onVoteResult(sessionId, r);
    return;
  }

  const eliminated = session.players.find(p => p.id === topVoted[0].playerId);
  if (eliminated) {
    eliminated.isAlive = false;
    const newAlive = session.players.filter(p => p.isAlive).length;
    const r: VoteResultData = { eliminated: true, eliminatedId: eliminated.id, eliminatedName: eliminated.name, isTie: false, voteCounts, aliveCount: newAlive };
    session.voteResult = r;
    if (callbacks) callbacks.onVoteResult(sessionId, r);

    // Audio: random pistol for elimination
    const pistols: Array<'pistol1' | 'pistol2' | 'pistol3'> = ['pistol1', 'pistol2', 'pistol3'];
    const randomPistol = pistols[Math.floor(Math.random() * pistols.length)];
    const pistolCue: AudioCuePayload = { type: 'duck_and_play', file: randomPistol, duckTo: 0.08 };
    if (callbacks) callbacks.onAudioCue(sessionId, pistolCue);
  }
}

// ============================================
// Win Condition
// ============================================

function checkWinCondition(session: GameSession): WinResult | null {
  const aliveMafia = session.players.filter(p => p.role === PlayerRole.MAFIA && p.isAlive).length;
  const aliveNonMafia = session.players.filter(p => p.role !== PlayerRole.MAFIA && p.isAlive).length;
  if (aliveMafia === 0) return WinResult.CITIZEN_WIN;
  if (aliveMafia >= aliveNonMafia) return WinResult.MAFIA_WIN;
  return null;
}

function endGame(sessionId: string, result: WinResult): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.isGameOver = true;
  session.winResult = result;
  session.phase = GamePhase.GAME_OVER;

  const winnerName = result === WinResult.MAFIA_WIN ? 'المافيا' : 'المدنيون';
  console.log(`\n🏁 [${session.code}] GAME OVER → ${winnerName}`);

  if (callbacks) {
    callbacks.onGameOver(sessionId, { winner: result, winnerName, players: session.players });
    callbacks.onSessionUpdated(sessionId, session);
  }
}

// ============================================
// Public Helpers
// ============================================

export function getSessionByPlayer(playerId: string): GameSession | null {
  const sessionId = playerToSession.get(playerId);
  return sessionId ? sessions.get(sessionId) || null : null;
}

export function getSessionIdByPlayer(playerId: string): string | null {
  return playerToSession.get(playerId) || null;
}

export function getAliveMafiaIds(sessionId: string): string[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return session.players.filter(p => p.role === PlayerRole.MAFIA && p.isAlive).map(p => p.id);
}

export function getHostId(sessionId: string): string | null {
  const session = sessions.get(sessionId);
  return session ? session.hostId : null;
}
