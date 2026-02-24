// ============================================
// Doubt Game - Socket.IO Server
// EO-01: Host-Managed Game
// EO-A01: Identity Refactor (UUID-based)
// ============================================

import { Server, Socket } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, GameSession, PHASE_INFO } from '../types/game';
import {
  setCallbacks, createSession, joinSession,
  startGame, hostSetPhase, hostOpenChat, hostCloseChat,
  hostOpenVoting, hostCloseVoting, hostResolveNight, hostSendPrompt,
  hostRestartGame, postGameRespond, hostStartNewRound,
  selectNightTarget, doctorProtect, detectiveCheck, sendMafiaChat,
  castVote, sendChatMessage,
  getAliveMafiaIds, getHostId,
  resolvePlayerId, resolveSocketId, unmapSocket, mapSocket,
  reconnectHost, markPlayerDisconnected,
} from './gameEngine';

// Helper: get playerId from socket, with fallback error
function pid(socketId: string): string {
  const id = resolvePlayerId(socketId);
  if (!id) throw new Error('no player for socket');
  return id;
}

export function setupSocketServer(io: Server<ClientToServerEvents, ServerToClientEvents>): void {

  setCallbacks({
    onPhaseChange: (sid, data) => io.to(sid).emit('phase:changed', data),
    onSessionUpdated: (sid, session) => io.to(sid).emit('session:updated', sanitizeSession(session)),
    onRoleAssigned: (playerId, data) => {
      // Need to emit to the socket, not the playerId — find socket by player
      // For now, players are in the session room, so we emit to their socketId
      const socketId = findSocketByPlayer(io, playerId);
      if (socketId) io.to(socketId).emit('role:assigned', data);
    },
    onNightTargetSelected: (sid, data, mafiaOnly) => {
      if (mafiaOnly) {
        const mafiaPlayerIds = getAliveMafiaIds(sid);
        const hostPid = getHostId(sid);
        mafiaPlayerIds.forEach(mpid => {
          const s = findSocketByPlayer(io, mpid);
          if (s) io.to(s).emit('night:target_selected', data);
        });
        if (hostPid) {
          const s = findSocketByPlayer(io, hostPid);
          if (s) io.to(s).emit('night:target_selected', data);
        }
      }
    },
    onDoctorSelected: (playerId, data) => {
      const s = findSocketByPlayer(io, playerId);
      if (s) io.to(s).emit('night:doctor_selected', data);
    },
    onDetectiveSelected: (playerId, data) => {
      const s = findSocketByPlayer(io, playerId);
      if (s) io.to(s).emit('night:detective_selected', data);
    },
    onMorningResult: (sid, data) => io.to(sid).emit('morning:kill_result', data),
    onDetectiveResult: (playerId, data) => {
      const s = findSocketByPlayer(io, playerId);
      if (s) io.to(s).emit('detective:result', data);
    },
    onMafiaMessage: (sid, msg) => {
      const mafiaPlayerIds = getAliveMafiaIds(sid);
      const hostPid = getHostId(sid);
      mafiaPlayerIds.forEach(mpid => {
        const s = findSocketByPlayer(io, mpid);
        if (s) io.to(s).emit('mafia:message', msg);
      });
      if (hostPid) {
        const s = findSocketByPlayer(io, hostPid);
        if (s) io.to(s).emit('mafia:message', msg);
      }
    },
    onNightReadiness: (hostPlayerId, data) => {
      const s = findSocketByPlayer(io, hostPlayerId);
      if (s) io.to(s).emit('night:readiness', data);
    },
    onVoteUpdate: (sid, data) => io.to(sid).emit('vote:update', data),
    onVoteResult: (sid, data) => io.to(sid).emit('vote:result', data),
    onChatMessage: (sid, msg) => io.to(sid).emit('chat:message', msg),
    onChatState: (sid, open) => io.to(sid).emit('chat:state', { open }),
    onVotingState: (sid, open) => io.to(sid).emit('voting:state', { open }),
    onGameOver: (sid, data) => io.to(sid).emit('game:over', data),
    onAudioCue: (sid, cue) => io.to(sid).emit('audio:cue', cue),
    onPostGameStart: (sid, data) => io.to(sid).emit('post_game:start', data),
    onPostGameUpdate: (sid, data) => io.to(sid).emit('post_game:update', data),
    onPlayerLeft: (sid, playerId) => io.to(sid).emit('player:left', playerId),
  });

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // Host creates session — or reconnects if UUID already has one
    socket.on('session:create', (hostPlayerId: any, callback: any) => {
      try {
        // Try reconnect first
        const reconn = reconnectHost(hostPlayerId, socket.id);
        if (reconn) {
          socket.join(reconn.session.id);
          callback({ success: true, session: sanitizeSession(reconn.session), playerId: hostPlayerId, isHost: true });
          return;
        }
        // New session
        const { session } = createSession(hostPlayerId, socket.id);
        socket.join(session.id);
        callback({ success: true, session: sanitizeSession(session), playerId: hostPlayerId, isHost: true });
      } catch { callback({ success: false, error: 'خطأ' }); }
    });

    // Player joins via code — or reconnects with same UUID
    socket.on('session:join', (code: any, playerName: any, playerId: any, callback: any) => {
      try {
        const result = joinSession(code, playerName, playerId, socket.id);
        if ('error' in result) { callback({ success: false, error: result.error }); return; }
        const { session, player, reconnected } = result;
        socket.join(session.id);
        if (!reconnected) {
          socket.to(session.id).emit('player:joined', player);
        }
        io.to(session.id).emit('session:updated', sanitizeSession(session));
        // Re-deliver role if reconnecting during active game
        if (reconnected && session.isStarted && player.role) {
          socket.emit('role:assigned', {
            role: player.role,
            description: player.role === 'MAFIA' ? 'أنت المافيا! اقتل المدنيين سراً'
              : player.role === 'DOCTOR' ? 'أنت الطبيب! أنقذ حياة واحدة كل ليلة'
              : player.role === 'DETECTIVE' ? 'أنت المحقق! اكشف هوية مشتبه واحد كل ليلة'
              : 'أنت مدني. اكشف المافيا وصوّت لطردهم!',
            isAlive: player.isAlive,
          } as any);
          // Re-deliver current phase
          const phaseInfo = { phase: session.phase, round: session.round, info: PHASE_INFO[session.phase] };
          socket.emit('phase:changed', phaseInfo as any);
        }
        callback({ success: true, session: sanitizeSession(session), playerId: player.id, isHost: false });
      } catch { callback({ success: false, error: 'خطأ' }); }
    });

    // Host commands — resolve socket.id → playerId first
    socket.on('host:start_game', (cb) => { try { cb(startGame(pid(socket.id))); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:set_phase', (phase, cb) => { try { cb(hostSetPhase(pid(socket.id), phase)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:open_chat', (cb) => { try { cb(hostOpenChat(pid(socket.id))); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:close_chat', (cb) => { try { cb(hostCloseChat(pid(socket.id))); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:open_voting', (cb) => { try { cb(hostOpenVoting(pid(socket.id))); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:close_voting', (cb) => { try { cb(hostCloseVoting(pid(socket.id))); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:resolve_night', (cb) => { try { cb(hostResolveNight(pid(socket.id))); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:send_prompt', (text: any, cb: any) => { try { cb(hostSendPrompt(pid(socket.id), text)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:restart_game', (cb: any) => { try { cb(hostRestartGame(pid(socket.id))); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:start_new_round', (cb: any) => { try { cb(hostStartNewRound(pid(socket.id))); } catch { cb({ success: false, error: 'خطأ' }); } });

    // Player actions — resolve socket.id → playerId first
    socket.on('night:select_target', (t, cb) => { try { cb(selectNightTarget(pid(socket.id), t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('night:doctor_protect', (t, cb) => { try { cb(doctorProtect(pid(socket.id), t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('night:detective_check', (t, cb) => { try { cb(detectiveCheck(pid(socket.id), t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('mafia:chat', (t, cb) => { try { cb(sendMafiaChat(pid(socket.id), t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('vote:cast', (t, cb) => { try { cb(castVote(pid(socket.id), t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('chat:send', (t, cb) => { try { cb(sendChatMessage(pid(socket.id), t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('post_game:respond', (choice: any, cb: any) => { try { cb(postGameRespond(pid(socket.id), choice)); } catch { cb({ success: false, error: 'خطأ' }); } });

    socket.on('disconnect', () => {
      console.log(`❌ Disconnected: ${socket.id}`);
      const playerId = unmapSocket(socket.id);
      if (!playerId) return;
      // Don't remove player — just mark disconnected (grace period)
      markPlayerDisconnected(playerId);
    });
  });
}

// Find socket ID by player UUID — look through connected sockets
function findSocketByPlayer(io: Server, playerId: string): string | null {
  return resolveSocketId(playerId);
}

function sanitizeSession(session: GameSession): GameSession {
  return {
    ...session,
    nightActions: { mafiaTarget: null, doctorProtect: null, detectiveCheck: null, lastDoctorProtect: null },
    mafiaMessages: [],
    mafiaMsgCount: {},
    votes: {},
    players: session.players.map(p => ({ ...p, socketId: '', role: session.isGameOver ? p.role : null })),
  };
}
