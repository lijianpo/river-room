import { parse } from 'cookie';
import { aiDifficultySchema, playerActionSchema } from '@poker/contracts';
import type { AuthService } from './auth.js';
import { SESSION_COOKIE } from './auth.js';
import type { PokerIo } from './room-manager.js';
import { RoomManager, withAck } from './room-manager.js';
import type { PresenceService } from './presence.js';

export function registerSocketHandlers(io: PokerIo, auth: AuthService, rooms: RoomManager, presence: PresenceService): void {
  io.use((socket, next) => {
    const cookies = parse(socket.handshake.headers.cookie ?? '');
    const session = auth.loadByToken(cookies[SESSION_COOKIE]);
    if (!session) return next(new Error('未登录或会话已过期'));
    if (session.mustChangePassword) return next(new Error('请先修改临时密码'));
    socket.data.auth = {
      identityId: session.identityId,
      userId: session.userId,
      displayName: session.displayName,
      email: session.email,
      isGuest: session.isGuest,
      avatarUrl: session.avatarUrl,
      isAdmin: session.isAdmin,
      mustChangePassword: session.mustChangePassword,
      accountStatus: session.accountStatus,
    };
    return next();
  });

  io.on('connection', (socket) => {
    presence.connect(socket.data.auth, socket.id);
    socket.on('connection:ping', (payload, callback) => {
      callback?.({ ok: true, nonce: payload.nonce, serverTime: Date.now() });
    });
    socket.on('room:subscribe', (payload, callback) => {
      withAck(callback, () => rooms.subscribe(socket, payload.roomId));
    });
    socket.on('room:leave', (payload, callback) => {
      withAck(callback, () => {
        rooms.leave(socket.data.auth, payload.roomId);
        void socket.leave(`room:${payload.roomId}`);
      });
    });
    socket.on('room:take-seat', (payload, callback) => {
      withAck(callback, () => rooms.takeSeat(socket.data.auth, payload.roomId, payload.seat, payload.buyInBb));
    });
    socket.on('room:stand-up', (payload, callback) => {
      withAck(callback, () => rooms.standUp(socket.data.auth, payload.roomId));
    });
    socket.on('room:start', (payload, callback) => {
      withAck(callback, () => rooms.start(socket.data.auth, payload.roomId));
    });
    socket.on('room:cancel-countdown', (payload, callback) => {
      withAck(callback, () => rooms.cancelCountdown(socket.data.auth, payload.roomId));
    });
    socket.on('room:add-bot', (payload, callback) => {
      withAck(callback, () => rooms.addBot(socket.data.auth, payload.roomId, aiDifficultySchema.parse(payload.difficulty)));
    });
    socket.on('room:remove-bot', (payload, callback) => {
      withAck(callback, () => rooms.removeBot(socket.data.auth, payload.roomId, payload.playerId));
    });
    socket.on('room:kick', (payload, callback) => {
      withAck(callback, () => rooms.kick(socket.data.auth, payload.roomId, payload.playerId));
    });
    socket.on('room:rebuy', (payload, callback) => {
      withAck(callback, () => rooms.rebuy(socket.data.auth, payload.roomId, payload.buyInBb));
    });
    socket.on('game:action', (payload, callback) => {
      withAck(callback, () => rooms.act(socket.data.auth, payload.roomId, playerActionSchema.parse(payload.action)));
    });
    socket.on('chat:send', (payload, callback) => {
      withAck(callback, () => rooms.sendChat(socket.data.auth, payload.roomId, payload.text));
    });
    socket.on('chat:report', (payload, callback) => {
      withAck(callback, () => rooms.reportChat(socket.data.auth, payload.roomId, payload.messageId));
    });
    socket.on('disconnect', () => {
      rooms.disconnect(socket);
      const result = presence.disconnect(socket.data.auth.identityId, socket.id);
      if (result.wentOffline && result.userId) auth.recordLastSeen(result.userId);
    });
  });
}
