// ============================================
// Doubt Game - Socket.IO Server
// EO-01: Host-Managed Game
// ============================================

import { Server, Socket } from 'socket.io';
import { ServerToClientEvents, ClientToServerEvents, GameSession } from '../types/game';
import {
  setCallbacks, createSession, joinSession, leaveSession,
  startGame, hostSetPhase, hostOpenChat, hostCloseChat,
  hostOpenVoting, hostCloseVoting, hostResolveNight, hostSendPrompt,
  hostRestartGame,
  selectNightTarget, doctorProtect, detectiveCheck, sendMafiaChat,
  castVote, sendChatMessage,
  getAliveMafiaIds, getHostId,
} from './gameEngine';

export function setupSocketServer(io: Server<ClientToServerEvents, ServerToClientEvents>): void {

  setCallbacks({
    onPhaseChange: (sid, data) => io.to(sid).emit('phase:changed', data),
    onSessionUpdated: (sid, session) => io.to(sid).emit('session:updated', sanitizeSession(session)),
    onRoleAssigned: (pid, data) => io.to(pid).emit('role:assigned', data),
    onNightTargetSelected: (sid, data, mafiaOnly) => {
      if (mafiaOnly) {
        const ids = getAliveMafiaIds(sid);
        const hostId = getHostId(sid);
        ids.forEach(id => io.to(id).emit('night:target_selected', data));
        if (hostId) io.to(hostId).emit('night:target_selected', data);
      }
    },
    onDoctorSelected: (pid, data) => io.to(pid).emit('night:doctor_selected', data),
    onDetectiveSelected: (pid, data) => io.to(pid).emit('night:detective_selected', data),
    onMorningResult: (sid, data) => io.to(sid).emit('morning:kill_result', data),
    onDetectiveResult: (pid, data) => io.to(pid).emit('detective:result', data),
    onMafiaMessage: (sid, msg) => {
      const ids = getAliveMafiaIds(sid);
      const hostId = getHostId(sid);
      ids.forEach(id => io.to(id).emit('mafia:message', msg));
      if (hostId) io.to(hostId).emit('mafia:message', msg);
    },
    onNightReadiness: (hostId, data) => io.to(hostId).emit('night:readiness', data),
    onVoteUpdate: (sid, data) => io.to(sid).emit('vote:update', data),
    onVoteResult: (sid, data) => io.to(sid).emit('vote:result', data),
    onChatMessage: (sid, msg) => io.to(sid).emit('chat:message', msg),
    onChatState: (sid, open) => io.to(sid).emit('chat:state', { open }),
    onVotingState: (sid, open) => io.to(sid).emit('voting:state', { open }),
    onGameOver: (sid, data) => io.to(sid).emit('game:over', data),
    onAudioCue: (sid, cue) => io.to(sid).emit('audio:cue', cue),
  });

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // Host creates session (no name needed)
    socket.on('session:create', (callback) => {
      try {
        const { session } = createSession(socket.id);
        socket.join(session.id);
        callback({ success: true, session: sanitizeSession(session), playerId: socket.id, isHost: true });
      } catch { callback({ success: false, error: 'خطأ' }); }
    });

    // Player joins via code
    socket.on('session:join', (code, playerName, callback) => {
      try {
        const result = joinSession(code, playerName, socket.id);
        if ('error' in result) { callback({ success: false, error: result.error }); return; }
        const { session, player } = result;
        socket.join(session.id);
        socket.to(session.id).emit('player:joined', player);
        io.to(session.id).emit('session:updated', sanitizeSession(session));
        callback({ success: true, session: sanitizeSession(session), playerId: socket.id, isHost: false });
      } catch { callback({ success: false, error: 'خطأ' }); }
    });

    // Host commands
    socket.on('host:start_game', (cb) => { try { cb(startGame(socket.id)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:set_phase', (phase, cb) => { try { cb(hostSetPhase(socket.id, phase)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:open_chat', (cb) => { try { cb(hostOpenChat(socket.id)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:close_chat', (cb) => { try { cb(hostCloseChat(socket.id)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:open_voting', (cb) => { try { cb(hostOpenVoting(socket.id)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:close_voting', (cb) => { try { cb(hostCloseVoting(socket.id)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:resolve_night', (cb) => { try { cb(hostResolveNight(socket.id)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:send_prompt', (text: any, cb: any) => { try { cb(hostSendPrompt(socket.id, text)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('host:restart_game', (cb: any) => { try { cb(hostRestartGame(socket.id)); } catch { cb({ success: false, error: 'خطأ' }); } });

    // Player actions
    socket.on('night:select_target', (t, cb) => { try { cb(selectNightTarget(socket.id, t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('night:doctor_protect', (t, cb) => { try { cb(doctorProtect(socket.id, t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('night:detective_check', (t, cb) => { try { cb(detectiveCheck(socket.id, t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('mafia:chat', (t, cb) => { try { cb(sendMafiaChat(socket.id, t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('vote:cast', (t, cb) => { try { cb(castVote(socket.id, t)); } catch { cb({ success: false, error: 'خطأ' }); } });
    socket.on('chat:send', (t, cb) => { try { cb(sendChatMessage(socket.id, t)); } catch { cb({ success: false, error: 'خطأ' }); } });

    socket.on('disconnect', () => {
      console.log(`❌ Disconnected: ${socket.id}`);
      const result = leaveSession(socket.id);
      if (result && result.session) {
        io.to(result.sessionId).emit('player:left', socket.id);
        io.to(result.sessionId).emit('session:updated', sanitizeSession(result.session));
      }
    });
  });
}

function sanitizeSession(session: GameSession): GameSession {
  return {
    ...session,
    nightActions: { mafiaTarget: null, doctorProtect: null, detectiveCheck: null, lastDoctorProtect: null },
    mafiaMessages: [],
    mafiaMsgCount: {},
    votes: {},
    players: session.players.map(p => ({ ...p, role: session.isGameOver ? p.role : null })),
  };
}
