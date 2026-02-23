// ============================================
// Doubt Game - Core Types
// EO-01: UX Core Reset - Host-Managed Game
// ============================================

export enum GamePhase {
  LOBBY      = 'LOBBY',
  NIGHT      = 'NIGHT',
  MORNING    = 'MORNING',
  DISCUSSION = 'DISCUSSION',
  VOTING     = 'VOTING',
  RESULT     = 'RESULT',
  GAME_OVER  = 'GAME_OVER',
}

export enum PlayerRole {
  MAFIA     = 'MAFIA',
  CITIZEN   = 'CITIZEN',
  DOCTOR    = 'DOCTOR',
  DETECTIVE = 'DETECTIVE',
}

export const PHASE_INFO: Record<GamePhase, { name: string; description: string; icon: string }> = {
  [GamePhase.LOBBY]:      { name: 'الانتظار',    description: 'في انتظار اللاعبين...',  icon: '🏠' },
  [GamePhase.NIGHT]:      { name: 'الليل',       description: 'المدينة نائمة...',       icon: '🌙' },
  [GamePhase.MORNING]:    { name: 'الصباح',      description: 'المدينة تستيقظ...',       icon: '🌅' },
  [GamePhase.DISCUSSION]: { name: 'النقاش',      description: 'ناقشوا!',                icon: '💬' },
  [GamePhase.VOTING]:     { name: 'التصويت',     description: 'صوّتوا لطرد المشبوه!',    icon: '🗳️' },
  [GamePhase.RESULT]:     { name: 'النتيجة',     description: 'نتيجة التصويت...',        icon: '📊' },
  [GamePhase.GAME_OVER]:  { name: 'انتهت اللعبة', description: '',                       icon: '🏁' },
};

/** حد رسائل قناة المافيا السرية */
export const MAX_MAFIA_CHAT_LENGTH = 60;
export const MAX_MAFIA_MESSAGES = 3;

/**
 * توزيع الأدوار:
 * < 10 لاعبين: 1 مافيا
 * >= 10 لاعبين: 2 مافيا
 * >= 4: + محقق
 * >= 6: + طبيب
 */
export function getRoleDistribution(playerCount: number): PlayerRole[] {
  const mafiaCount = playerCount >= 10 ? 2 : 1;
  const roles: PlayerRole[] = Array(mafiaCount).fill(PlayerRole.MAFIA);

  if (playerCount >= 6) roles.push(PlayerRole.DOCTOR);
  if (playerCount >= 4) roles.push(PlayerRole.DETECTIVE);

  while (roles.length < playerCount) roles.push(PlayerRole.CITIZEN);
  return roles;
}

// ============================================
// Player & Session
// ============================================

export interface Player {
  id: string;
  name: string;
  role: PlayerRole | null;
  isAlive: boolean;
  isConnected: boolean;
  joinedAt: number;
}

export enum WinResult {
  MAFIA_WIN   = 'MAFIA_WIN',
  CITIZEN_WIN = 'CITIZEN_WIN',
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  isHost: boolean;
  timestamp: number;
}

export interface MafiaChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

export interface NightActions {
  mafiaTarget: string | null;
  doctorProtect: string | null;
  detectiveCheck: string | null;
  lastDoctorProtect: string | null;
}

export interface DetectiveResult {
  targetId: string;
  targetName: string;
  isMafia: boolean;
}

/** حالة جاهزية الليل للـ Host فقط (بدون تفاصيل) */
export interface NightReadiness {
  mafiaReady: boolean;
  doctorReady: boolean;
  detectiveReady: boolean;
  hasMafia: boolean;
  hasDoctor: boolean;
  hasDetective: boolean;
  allReady: boolean;
}

export interface GameSession {
  id: string;
  code: string;
  hostId: string;                  // Host socket ID - لا يلعب
  players: Player[];               // اللاعبون فقط (بدون Host)
  phase: GamePhase;
  round: number;
  isStarted: boolean;
  isGameOver: boolean;
  winResult: WinResult | null;
  // Night
  nightActions: NightActions;
  lastKilled: string | null;
  lastKilledName: string | null;
  // Chat - مفتوح/مغلق بتحكم Host
  chatOpen: boolean;
  messages: ChatMessage[];
  // Mafia Chat
  mafiaMessages: MafiaChatMessage[];
  mafiaMsgCount: Record<string, number>;
  // Voting
  votingOpen: boolean;
  votes: Record<string, string>;
  voteResult: VoteResultData | null;
  createdAt: number;
}

// ============================================
// Socket Events
// ============================================

export interface ClientToServerEvents {
  // Session
  'session:create': (callback: (response: SessionResponse) => void) => void;
  'session:join': (code: string, playerName: string, callback: (response: SessionResponse) => void) => void;
  // Host commands
  'host:start_game': (callback: (response: BaseResponse) => void) => void;
  'host:set_phase': (phase: string, callback: (response: BaseResponse) => void) => void;
  'host:open_chat': (callback: (response: BaseResponse) => void) => void;
  'host:close_chat': (callback: (response: BaseResponse) => void) => void;
  'host:open_voting': (callback: (response: BaseResponse) => void) => void;
  'host:close_voting': (callback: (response: BaseResponse) => void) => void;
  'host:resolve_night': (callback: (response: BaseResponse) => void) => void;
  'host:send_prompt': (text: string, callback: (response: BaseResponse) => void) => void;
  // Player actions
  'night:select_target': (targetId: string, callback: (response: BaseResponse) => void) => void;
  'night:doctor_protect': (targetId: string, callback: (response: BaseResponse) => void) => void;
  'night:detective_check': (targetId: string, callback: (response: BaseResponse) => void) => void;
  'mafia:chat': (text: string, callback: (response: BaseResponse) => void) => void;
  'vote:cast': (targetId: string, callback: (response: BaseResponse) => void) => void;
  'chat:send': (text: string, callback: (response: BaseResponse) => void) => void;
}

export interface ServerToClientEvents {
  'session:updated': (session: GameSession) => void;
  'phase:changed': (data: PhaseChangeData) => void;
  'player:joined': (player: Player) => void;
  'player:left': (playerId: string) => void;
  'role:assigned': (data: RoleAssignment) => void;
  'night:target_selected': (data: NightTargetData) => void;
  'night:doctor_selected': (data: { targetName: string }) => void;
  'night:detective_selected': (data: { targetName: string }) => void;
  'night:readiness': (data: NightReadiness) => void;
  'morning:kill_result': (data: MorningResult) => void;
  'detective:result': (data: DetectiveResult) => void;
  'mafia:message': (message: MafiaChatMessage) => void;
  'vote:update': (data: VoteUpdateData) => void;
  'vote:result': (data: VoteResultData) => void;
  'chat:message': (message: ChatMessage) => void;
  'chat:state': (data: { open: boolean }) => void;
  'voting:state': (data: { open: boolean }) => void;
  'game:over': (data: GameOverData) => void;
  'audio:cue': (data: AudioCuePayload) => void;
  'error': (message: string) => void;
}

// ============================================
// Data Types
// ============================================

export interface RoleAssignment {
  role: PlayerRole;
  teammates: string[];
}

export interface NightTargetData {
  targetId: string;
  targetName: string;
  selectedBy: string;
}

export interface MorningResult {
  killed: boolean;
  killedName: string | null;
  killedId: string | null;
  aliveCount: number;
}

export interface VoteUpdateData {
  voterId: string;
  voterName: string;
  totalVotes: number;
  totalEligible: number;
}

export interface VoteResultData {
  eliminated: boolean;
  eliminatedId: string | null;
  eliminatedName: string | null;
  isTie: boolean;
  voteCounts: VoteCount[];
  aliveCount: number;
}

export interface VoteCount {
  playerId: string;
  playerName: string;
  count: number;
}

export interface GameOverData {
  winner: WinResult;
  winnerName: string;
  players: Player[];
}

export interface PhaseChangeData {
  phase: GamePhase;
  round: number;
  info: { name: string; description: string; icon: string };
}

export interface BaseResponse {
  success: boolean;
  error?: string;
}

/** Audio cue from server */
export interface AudioCuePayload {
  type: 'duck_and_play' | 'play_only' | 'duck' | 'restore';
  file?: string;
  duckTo?: number;
  delayMs?: number;
}

export interface SessionResponse extends BaseResponse {
  session?: GameSession;
  playerId?: string;
  isHost?: boolean;
}
