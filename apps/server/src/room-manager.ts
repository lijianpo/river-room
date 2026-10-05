import { randomUUID } from 'node:crypto';
import type {
  Ack,
  AiDifficulty,
  AuthUser,
  ChatMessage,
  ClientToServerEvents,
  EmoteId,
  GameEventView,
  GameSnapshot,
  PlayerAction,
  PublicRoomSummary,
  RoomConfig,
  RoomInvitePreview,
  ServerToClientEvents,
  ShowdownResultView,
} from '@poker/contracts';
import {
  cardCode,
  decideAiAction,
  HoldemEngine,
  type EnginePlayer,
  type EnginePlayerInput,
} from '@poker/game-engine';
import type { BankrollService } from './bankroll.js';
import type { Server, Socket } from 'socket.io';
import { config } from './config.js';
import type { PersistenceService, PersistedParticipant, TournamentStanding } from './persistence.js';

export interface SocketData {
  auth: AuthUser;
}

export type PokerIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type PokerSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface LiveSeat {
  identityId: string;
  userId: string | null;
  name: string;
  seat: number;
  stack: number;
  isBot: boolean;
  difficulty: AiDifficulty | null;
  connected: boolean;
  socketIds: Set<string>;
  leavingAfterHand: boolean;
  placement: number | null;
  avatarUrl: string;
  isGuest: boolean;
  exitAfterHand: boolean;
  forfeited: boolean;
  buyInChips: number | null;
  stakeId: string | null;
  sittingOut: boolean;
  sitOutSince: number | null;
  consecutiveTimeouts: number;
  timeBankMs: number;
}

interface LiveMember {
  identityId: string;
  userId: string | null;
  name: string;
  avatarUrl: string;
  isGuest: boolean;
  connected: boolean;
  socketIds: Set<string>;
}

interface LiveRoom {
  id: string;
  code: string;
  config: RoomConfig;
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  hostId: string;
  members: Map<string, LiveMember>;
  seats: Map<string, LiveSeat>;
  engine: HoldemEngine | null;
  gameSessionId: string | null;
  handNumber: number;
  dealerSeat: number | null;
  handStartedAt: number | null;
  handStartStacks: Map<string, number>;
  tournamentStartedAt: number | null;
  actionDeadline: number | null;
  countdownDeadline: number | null;
  actionTimer: NodeJS.Timeout | null;
  transitionTimer: NodeJS.Timeout | null;
  countdownTimer: NodeJS.Timeout | null;
  reconnectTimers: Map<string, NodeJS.Timeout>;
  processedActionIds: Set<string>;
  chat: ChatMessage[];
  chatRate: Map<string, number[]>;
  /** 每位玩家上次发送表情的时间，用于限频 */
  emoteRate: Map<string, number>;
  createdAt: number;
  resultMessage: string | null;
  showdown: ShowdownResultView | null;
  tournamentEntries: Map<string, { userId: string | null; placement: number | null }>;
  /** 正在使用时间银行的座位及开始时间 */
  timeBank: { identityId: string; startedAt: number } | null;
}

export interface RoomTiming {
  turnTimeoutMs: number;
  /** 每位真人的初始时间银行，0 表示关闭 */
  timeBankMs: number;
}

/** 每手结束后为真人回补的时间银行 */
const TIME_BANK_REFILL_MS = 2_000;
/** 时间银行上限 */
const TIME_BANK_MAX_MS = 60_000;
/** 连续超时多少次后自动暂离 */
const AUTO_SIT_OUT_TIMEOUTS = 2;
/** 暂离超过该时长后自动离座 */
const SIT_OUT_LIMIT_MS = 10 * 60_000;

const TOURNAMENT_BLINDS = [
  [10, 20],
  [15, 30],
  [25, 50],
  [50, 100],
  [75, 150],
  [100, 200],
  [150, 300],
  [200, 400],
  [300, 600],
  [400, 800],
] as const;

const ACTION_NAMES: Record<string, string> = {
  small_blind: '下小盲',
  big_blind: '下大盲',
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注',
  all_in: '全押',
  deal: '开始发牌',
  win: '赢得底池',
};

/** 同一玩家两次表情之间的最短间隔 */
const EMOTE_COOLDOWN_MS = 3_000;

const BAD_WORDS = ['傻逼', '操你', 'fuck', 'shit'];

function inviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let index = 0; index < 6; index += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  return value;
}

function safeCallback(callback: ((value: Ack) => void) | undefined, result: Ack): void {
  callback?.(result);
}

export class RoomManager {
  private readonly rooms = new Map<string, LiveRoom>();
  private readonly identityRooms = new Map<string, string>();
  private readonly persistedHands = new Set<string>();
  private readonly timing: RoomTiming;

  constructor(
    private readonly io: PokerIo,
    private readonly persistence: PersistenceService,
    private readonly bankroll: BankrollService,
    private readonly showdownDurationSeconds: () => number = () => 8,
    timing: Partial<RoomTiming> = {},
  ) {
    this.timing = { turnTimeoutMs: config.turnTimeoutMs, timeBankMs: config.timeBankMs, ...timing };
  }

  listPublicRooms(): PublicRoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.config.visibility === 'public')
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((room) => this.summary(room, false));
  }

  invitePreview(code: string): RoomInvitePreview | null {
    const room = this.findRoom(code);
    if (!room) return null;
    const summary = this.summary(room, false);
    return {
      name: summary.name,
      mode: summary.mode,
      ranked: summary.ranked,
      visibility: summary.visibility,
      status: summary.status,
      seated: summary.seated,
      maxSeats: summary.maxSeats,
      spectators: summary.spectators,
    };
  }

  createRoom(auth: AuthUser, configInput: RoomConfig, buyInBb?: number): PublicRoomSummary {
    if (this.identityRooms.has(auth.identityId)) throw new Error('你已经在另一个房间中');
    if (configInput.ranked && auth.isGuest) throw new Error('游客不能创建排位房');
    const id = randomUUID();
    let code = inviteCode();
    while ([...this.rooms.values()].some((room) => room.code === code)) code = inviteCode();
    const roomConfig: RoomConfig = configInput.ranked
      ? {
          ...configInput,
          visibility: 'public',
          autoFillAi: false,
          smallBlind: 10,
          bigBlind: 20,
          startingStackBb: 100,
        }
      : configInput;
    const room: LiveRoom = {
      id,
      code,
      config: roomConfig,
      status: 'waiting',
      hostId: auth.identityId,
      members: new Map(),
      seats: new Map(),
      engine: null,
      gameSessionId: null,
      handNumber: 0,
      dealerSeat: null,
      handStartedAt: null,
      handStartStacks: new Map(),
      tournamentStartedAt: null,
      actionDeadline: null,
      countdownDeadline: null,
      actionTimer: null,
      transitionTimer: null,
      countdownTimer: null,
      reconnectTimers: new Map(),
      processedActionIds: new Set(),
      chat: [],
      chatRate: new Map(),
      emoteRate: new Map(),
      createdAt: Date.now(),
      resultMessage: null,
      showdown: null,
      tournamentEntries: new Map(),
      timeBank: null,
    };
    this.rooms.set(id, room);
    try {
      this.addHumanSeat(room, auth, 0, buyInBb);
    } catch (error) {
      this.rooms.delete(id);
      throw error;
    }
    this.lobbyChanged();
    return this.summary(room, true);
  }

  joinRoom(auth: AuthUser, roomIdOrCode: string): PublicRoomSummary {
    const room = this.findRoom(roomIdOrCode);
    if (!room) throw new Error('房间不存在或邀请码无效');
    if (room.status === 'finished') throw new Error('房间已结束');
    if (room.config.ranked && auth.isGuest) throw new Error('排位房仅允许注册用户进入');
    const existingRoomId = this.identityRooms.get(auth.identityId);
    if (existingRoomId && existingRoomId !== room.id) throw new Error('你已经在另一个房间中');
    if (room.members.has(auth.identityId)) return this.summary(room, true);
    const spectators = room.members.size - [...room.seats.values()].filter((seat) => !seat.isBot).length;
    if (spectators >= config.maxSpectatorsPerRoom) throw new Error('观战人数已满');
    this.addMember(room, auth);
    this.addSystemMessage(room, `${auth.displayName} 进入房间观战`);
    this.broadcast(room);
    this.lobbyChanged();
    return this.summary(room, true);
  }

  roomForIdentity(identityId: string): PublicRoomSummary | null {
    const roomId = this.identityRooms.get(identityId);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    return room ? this.summary(room, true) : null;
  }

  shutdown(): void {
    for (const room of this.rooms.values()) {
      if (room.actionTimer) clearTimeout(room.actionTimer);
      if (room.transitionTimer) clearTimeout(room.transitionTimer);
      if (room.countdownTimer) clearTimeout(room.countdownTimer);
      for (const timer of room.reconnectTimers.values()) clearTimeout(timer);
    }
    this.bankroll.recoverActiveStakes();
    this.rooms.clear();
    this.identityRooms.clear();
  }

  disableUser(userId: string): void {
    const identityId = `u:${userId}`;
    const roomId = this.identityRooms.get(identityId);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room) return;
    const seat = room.seats.get(identityId);
    if (!seat) {
      this.removeMember(room, identityId);
    } else if (room.config.mode === 'tournament' && room.status === 'playing' && seat.stack > 0) {
      this.forfeitTournamentSeat(room, seat, true);
      return;
    } else if (room.engine && !room.engine.isComplete && room.engine.getPlayer(identityId)) {
      seat.leavingAfterHand = true;
      seat.exitAfterHand = true;
      if (room.engine.actingSeat === seat.seat) {
        room.engine.applyAction(identityId, { type: 'fold' });
        this.scheduleTurn(room);
      }
      this.removeMember(room, identityId, true);
    } else {
      this.removeMember(room, identityId);
    }
    if (this.rooms.has(room.id)) {
      this.broadcast(room);
      this.lobbyChanged();
    }
  }

  subscribe(socket: PokerSocket, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('房间不存在');
    const member = room.members.get(socket.data.auth.identityId);
    if (!member) throw new Error('请先加入房间');
    for (const oldSocketId of member.socketIds) {
      if (oldSocketId === socket.id) continue;
      const oldSocket = this.io.sockets.sockets.get(oldSocketId);
      oldSocket?.emit('app:error', { message: '账号已在另一个页面连接，本页面已退出牌桌' });
      oldSocket?.disconnect(true);
    }
    member.socketIds.clear();
    member.socketIds.add(socket.id);
    member.connected = true;
    const seat = room.seats.get(member.identityId);
    if (seat) {
      seat.socketIds.clear();
      seat.socketIds.add(socket.id);
      seat.connected = true;
    }
    const timer = room.reconnectTimers.get(member.identityId);
    if (timer) clearTimeout(timer);
    room.reconnectTimers.delete(member.identityId);
    void socket.join(this.channel(room.id));
    socket.emit('room:chat-history', room.chat);
    this.emitSnapshot(room, socket);
    this.broadcast(room);
    this.lobbyChanged();
  }

  disconnect(socket: PokerSocket): void {
    const roomId = this.identityRooms.get(socket.data.auth.identityId);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    const member = room?.members.get(socket.data.auth.identityId);
    if (!room || !member) return;
    member.socketIds.delete(socket.id);
    const seat = room.seats.get(member.identityId);
    seat?.socketIds.delete(socket.id);
    if (member.socketIds.size > 0) return;
    member.connected = false;
    if (seat) seat.connected = false;
    const timer = setTimeout(() => this.handleReconnectExpired(room.id, member.identityId), config.reconnectGraceMs);
    room.reconnectTimers.set(member.identityId, timer);
    this.broadcast(room);
    this.lobbyChanged();
  }

  leave(auth: AuthUser, roomId: string): void {
    const room = this.requireRoom(roomId);
    const seat = room.seats.get(auth.identityId);
    if (!room.members.has(auth.identityId)) return;
    if (!seat) {
      this.removeMember(room, auth.identityId);
      this.broadcast(room);
      this.lobbyChanged();
      return;
    }
    if (room.status === 'playing' && room.config.mode === 'tournament' && seat.stack > 0) {
      this.forfeitTournamentSeat(room, seat, true);
      return;
    }
    if (room.engine && !room.engine.isComplete && room.engine.getPlayer(seat.identityId)) {
      seat.leavingAfterHand = true;
      seat.exitAfterHand = true;
      seat.connected = false;
      this.removeMember(room, seat.identityId, true);
      if (room.engine.actingSeat === seat.seat) {
        room.engine.applyAction(seat.identityId, { type: 'fold' });
        this.scheduleTurn(room);
      }
    } else {
      this.removeMember(room, seat.identityId);
    }
    this.broadcast(room);
    this.lobbyChanged();
  }

  takeSeat(auth: AuthUser, roomId: string, seatNumber: number, buyInBb?: number): void {
    const room = this.requireRoom(roomId);
    const member = room.members.get(auth.identityId);
    if (!member) throw new Error('请先进入房间');
    if (!Number.isInteger(seatNumber) || seatNumber < 0 || seatNumber >= room.config.maxSeats) throw new Error('座位编号无效');
    if (room.seats.has(auth.identityId)) return;
    if ([...room.seats.values()].some((seat) => seat.seat === seatNumber)) throw new Error('这个座位刚刚被占用了');
    if (room.status === 'finished') throw new Error('牌局已经结束');
    if (room.config.ranked && auth.isGuest) throw new Error('游客只能观战排位桌');
    if (room.config.mode === 'tournament' && room.status !== 'waiting' && room.status !== 'countdown') {
      throw new Error('锦标赛已经开始，只能观战');
    }
    this.addHumanSeat(room, auth, seatNumber, buyInBb);
    this.addSystemMessage(room, `${member.name} 坐到了 ${seatNumber + 1} 号座位`);
    this.broadcast(room);
    this.lobbyChanged();
    this.maybeResumeCash(room);
  }

  standUp(auth: AuthUser, roomId: string): void {
    const room = this.requireRoom(roomId);
    const seat = room.seats.get(auth.identityId);
    if (!seat) return;
    if (room.config.mode === 'tournament' && room.status === 'playing' && seat.stack > 0) {
      this.forfeitTournamentSeat(room, seat, false);
      return;
    }
    if (room.engine && !room.engine.isComplete && room.engine.getPlayer(seat.identityId)) {
      seat.leavingAfterHand = true;
      seat.exitAfterHand = false;
      if (room.engine.actingSeat === seat.seat) {
        room.engine.applyAction(seat.identityId, { type: 'fold' });
        this.scheduleTurn(room);
      }
      this.addSystemMessage(room, `${seat.name} 将在本手结束后离座`);
    } else {
      this.removeSeat(room, seat.identityId, true);
      this.addSystemMessage(room, `${seat.name} 离座观战`);
    }
    this.broadcast(room);
    this.lobbyChanged();
  }

  sitOut(auth: AuthUser, roomId: string): void {
    const room = this.requireRoom(roomId);
    const seat = room.seats.get(auth.identityId);
    if (!seat) throw new Error('你还没有入座');
    if (room.config.mode !== 'cash') throw new Error('锦标赛不能暂离');
    if (seat.sittingOut) return;
    this.markSittingOut(room, seat);
    this.addSystemMessage(room, `${seat.name} 暂时离开，将从下一手开始不参与发牌`);
    this.broadcast(room);
  }

  sitIn(auth: AuthUser, roomId: string): void {
    const room = this.requireRoom(roomId);
    const seat = room.seats.get(auth.identityId);
    if (!seat) throw new Error('你还没有入座');
    if (!seat.sittingOut) return;
    seat.sittingOut = false;
    seat.sitOutSince = null;
    seat.consecutiveTimeouts = 0;
    this.addSystemMessage(room, `${seat.name} 回到了牌局`);
    this.broadcast(room);
    this.maybeResumeCash(room);
  }

  start(auth: AuthUser, roomId: string): void {
    const room = this.requireHost(auth, roomId);
    if (room.status !== 'waiting') throw new Error('当前不能开始牌局');
    if (![...room.seats.values()].some((seat) => !seat.isBot)) throw new Error('至少需要一名真人入座');
    if (room.seats.size < 2 && !room.config.autoFillAi) throw new Error('至少需要两名玩家');
    if (room.config.autoFillAi && room.seats.size < room.config.targetPlayers) {
      room.status = 'countdown';
      room.countdownDeadline = Date.now() + config.aiFillDelayMs;
      room.countdownTimer = setTimeout(() => {
        while (room.seats.size < room.config.targetPlayers) this.addBotInternal(room, room.config.aiDifficulty);
        this.beginGame(room);
      }, config.aiFillDelayMs);
      this.addSystemMessage(room, `等待真人加入，倒计时结束后将由 AI 补至 ${room.config.targetPlayers} 人`);
      this.broadcast(room);
      this.lobbyChanged();
      return;
    }
    this.beginGame(room);
  }

  cancelCountdown(auth: AuthUser, roomId: string): void {
    const room = this.requireHost(auth, roomId);
    if (room.status !== 'countdown') return;
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
    room.countdownDeadline = null;
    room.status = 'waiting';
    this.broadcast(room);
    this.lobbyChanged();
  }

  addBot(auth: AuthUser, roomId: string, difficulty: AiDifficulty): void {
    const room = this.requireHost(auth, roomId);
    if (room.config.ranked) throw new Error('排位房不能加入 AI');
    if (room.seats.size >= room.config.maxSeats) throw new Error('没有空座位');
    if (room.status === 'playing' && (room.config.mode !== 'cash' || (room.engine && !room.engine.isComplete))) {
      throw new Error('只能在两手牌之间添加 AI');
    }
    if (room.status === 'finished') throw new Error('牌局已经结束');
    this.addBotInternal(room, difficulty);
    this.broadcast(room);
    this.lobbyChanged();
    this.maybeResumeCash(room);
  }

  removeBot(auth: AuthUser, roomId: string, playerId: string): void {
    const room = this.requireHost(auth, roomId);
    const seat = room.seats.get(playerId);
    if (!seat?.isBot) throw new Error('指定玩家不是 AI');
    if (room.status === 'playing' && (room.config.mode !== 'cash' || (room.engine && !room.engine.isComplete))) {
      throw new Error('只能在两手牌之间移除 AI');
    }
    this.removeSeat(room, playerId);
    this.broadcast(room);
    this.lobbyChanged();
  }

  kick(auth: AuthUser, roomId: string, playerId: string): void {
    const room = this.requireHost(auth, roomId);
    if (playerId === auth.identityId) throw new Error('房主不能踢出自己');
    const seat = room.seats.get(playerId);
    if (!seat) throw new Error('玩家不在房间');
    if (room.engine && !room.engine.isComplete && room.engine.getPlayer(playerId)) {
      seat.leavingAfterHand = true;
      seat.exitAfterHand = true;
      seat.connected = false;
      this.removeMember(room, seat.identityId, true);
      if (room.engine.actingSeat === seat.seat) {
        room.engine.applyAction(playerId, { type: 'fold' });
        this.scheduleTurn(room);
      }
    } else this.removeMember(room, playerId);
    for (const socketId of seat.socketIds) {
      const socket = this.io.sockets.sockets.get(socketId);
      socket?.emit('app:error', { message: '你已被房主移出房间' });
      void socket?.leave(this.channel(room.id));
    }
    this.addSystemMessage(room, `${seat.name} 已被移出房间`);
    this.broadcast(room);
    this.lobbyChanged();
  }

  rebuy(auth: AuthUser, roomId: string, buyInBb?: number): void {
    const room = this.requireRoom(roomId);
    if (room.config.mode !== 'cash') throw new Error('锦标赛不能补充筹码');
    const seat = room.seats.get(auth.identityId);
    if (!seat) throw new Error('你不在该房间');
    if (room.engine && !room.engine.isComplete) throw new Error('只能在两手牌之间补充筹码');
    if (seat.stack > 0) throw new Error('筹码尚未用尽');
    if (this.isRankedCash(room)) {
      if (!auth.userId || !seat.userId) throw new Error('排位房仅允许注册用户买入');
      if (seat.stakeId) this.bankroll.settleStake(seat.stakeId, 0);
      const buyInChips = this.validateBuyIn(room, buyInBb);
      const stake = this.bankroll.openStake({
        userId: auth.userId,
        identityId: auth.identityId,
        roomId: room.id,
        buyInChips,
      });
      seat.stack = buyInChips;
      seat.buyInChips = buyInChips;
      seat.stakeId = stake.id;
      this.notifyWallet(auth.userId);
    } else {
      seat.stack = this.startingStack(room);
    }
    this.addSystemMessage(room, `${seat.name} 补充至 ${seat.stack} 筹码`);
    this.broadcast(room);
    this.maybeResumeCash(room);
  }

  act(auth: AuthUser, roomId: string, action: PlayerAction): void {
    const room = this.requireRoom(roomId);
    const seat = room.seats.get(auth.identityId);
    if (!seat || seat.leavingAfterHand || seat.forfeited) throw new Error('你已申请离座，不能继续行动');
    const engine = room.engine;
    if (!engine || engine.isComplete) throw new Error('当前没有进行中的手牌');
    if (room.processedActionIds.has(action.actionId)) return;
    if (action.handId !== engine.handId || action.version !== engine.version) throw new Error('牌局状态已更新，请按最新状态操作');
    room.processedActionIds.add(action.actionId);
    if (room.processedActionIds.size > 200) room.processedActionIds.clear();
    engine.applyAction(auth.identityId, { type: action.type, ...(action.amount === undefined ? {} : { amount: action.amount }) });
    seat.consecutiveTimeouts = 0;
    this.scheduleTurn(room);
  }

  sendChat(auth: AuthUser, roomId: string, rawText: string): ChatMessage {
    const room = this.requireRoom(roomId);
    const member = room.members.get(auth.identityId);
    if (!member) throw new Error('你不在该房间');
    const spectator = !room.seats.has(auth.identityId);
    if (spectator && (room.config.ranked || room.config.mode === 'tournament')) throw new Error('该牌桌的观众只能查看聊天');
    const text = rawText.trim();
    if (!text) throw new Error('消息不能为空');
    if (text.length > 200) throw new Error('消息不能超过 200 字');
    const now = Date.now();
    const recent = (room.chatRate.get(auth.identityId) ?? []).filter((time) => time > now - 10_000);
    if (recent.length >= 5) throw new Error('发送太快，请稍后再试');
    recent.push(now);
    room.chatRate.set(auth.identityId, recent);
    let filtered = text;
    for (const word of BAD_WORDS) filtered = filtered.replaceAll(new RegExp(word, 'gi'), '*'.repeat(word.length));
    const message: ChatMessage = {
      id: randomUUID(),
      senderId: auth.identityId,
      senderName: member.name,
      text: filtered,
      createdAt: now,
    };
    room.chat.push(message);
    if (room.chat.length > 50) room.chat.shift();
    this.io.to(this.channel(room.id)).emit('room:chat', message);
    return message;
  }

  sendEmote(auth: AuthUser, roomId: string, emote: EmoteId): void {
    const room = this.requireRoom(roomId);
    if (!room.seats.has(auth.identityId)) throw new Error('入座后才能发送表情');
    const now = Date.now();
    if (now - (room.emoteRate.get(auth.identityId) ?? 0) < EMOTE_COOLDOWN_MS) throw new Error('表情发送太快，请稍后再试');
    room.emoteRate.set(auth.identityId, now);
    this.io.to(this.channel(room.id)).emit('room:emote', { id: randomUUID(), playerId: auth.identityId, emote, at: now });
  }

  reportChat(auth: AuthUser, roomId: string, messageId: string): void {
    const room = this.requireRoom(roomId);
    if (!room.members.has(auth.identityId)) throw new Error('你不在该房间');
    const message = room.chat.find((candidate) => candidate.id === messageId);
    if (!message || message.system) throw new Error('找不到可举报的消息');
    this.persistence.saveReport({
      reporterIdentityId: auth.identityId,
      roomId,
      messageId,
      senderIdentityId: message.senderId,
      messageText: message.text,
    });
  }

  private beginGame(room: LiveRoom): void {
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
    room.countdownDeadline = null;
    if (room.seats.size < 2) throw new Error('至少需要两名玩家');
    room.status = 'playing';
    room.resultMessage = null;
    room.showdown = null;
    room.gameSessionId = randomUUID();
    room.tournamentStartedAt = Date.now();
    for (const seat of room.seats.values()) {
      if (!this.isRankedCash(room)) seat.stack = this.startingStack(room);
      seat.placement = null;
    }
    room.tournamentEntries = new Map(
      [...room.seats.values()]
        .filter((seat) => !seat.isBot)
        .map((seat) => [seat.identityId, { userId: seat.userId, placement: null }]),
    );
    this.persistence.createGameSession({
      id: room.gameSessionId,
      roomId: room.id,
      roomName: room.config.name,
      mode: room.config.mode,
      ranked: room.config.ranked,
      config: room.config,
      startedAt: Date.now(),
    });
    this.addSystemMessage(room, room.config.mode === 'cash' ? '常规桌牌局开始' : '单桌锦标赛开始');
    this.startHand(room);
    this.lobbyChanged();
  }

  private startHand(room: LiveRoom): void {
    if (room.transitionTimer) clearTimeout(room.transitionTimer);
    room.transitionTimer = null;
    room.showdown = null;
    room.resultMessage = null;
    const now = Date.now();
    for (const seat of [...room.seats.values()]) {
      if (seat.sittingOut && seat.sitOutSince !== null && now - seat.sitOutSince >= SIT_OUT_LIMIT_MS) {
        this.removeSeat(room, seat.identityId, true);
        this.addSystemMessage(room, `${seat.name} 暂离时间过长，已自动离座`);
        this.lobbyChanged();
      }
    }
    if (!this.rooms.has(room.id)) return;
    const activeSeats = [...room.seats.values()]
      .filter((seat) => seat.stack > 0 && !seat.leavingAfterHand && !seat.sittingOut)
      .filter((seat) => room.config.mode === 'tournament' || seat.isBot || seat.connected)
      .sort((left, right) => left.seat - right.seat);
    if (activeSeats.length < 2 || !activeSeats.some((seat) => !seat.isBot)) {
      room.engine = null;
      room.actionDeadline = null;
      this.broadcast(room);
      return;
    }
    room.handNumber += 1;
    room.handStartedAt = Date.now();
    room.handStartStacks = new Map(activeSeats.map((seat) => [seat.identityId, seat.stack]));
    room.processedActionIds.clear();
    room.dealerSeat = this.nextDealer(room.dealerSeat, activeSeats);
    const [smallBlind, bigBlind] = this.currentBlinds(room);
    const players: EnginePlayerInput[] = activeSeats.map((seat) => ({
      id: seat.identityId,
      name: seat.name,
      seat: seat.seat,
      stack: seat.stack,
    }));
    room.engine = new HoldemEngine({
      handId: randomUUID(),
      players,
      dealerSeat: room.dealerSeat,
      smallBlind,
      bigBlind,
    });
    this.scheduleTurn(room);
  }

  private scheduleTurn(room: LiveRoom): void {
    if (room.actionTimer) clearTimeout(room.actionTimer);
    room.actionTimer = null;
    room.actionDeadline = null;
    this.settleTimeBank(room);
    const engine = room.engine;
    if (!engine) return;
    this.syncStacksFromEngine(room, engine);
    if (engine.isComplete) {
      this.completeHand(room);
      return;
    }
    const acting = [...room.seats.values()].find((seat) => seat.seat === engine.actingSeat);
    if (!acting) throw new Error('找不到当前行动玩家');
    if (!acting.isBot && (acting.leavingAfterHand || acting.forfeited)) {
      engine.applyAction(acting.identityId, { type: 'fold' });
      this.scheduleTurn(room);
      return;
    }
    const delay = acting.isBot ? 600 + Math.floor(Math.random() * 900) : this.timing.turnTimeoutMs;
    this.armActionTimer(room, acting, delay);
    this.broadcast(room);
  }

  private armActionTimer(room: LiveRoom, acting: LiveSeat, delay: number): void {
    room.actionDeadline = Date.now() + delay;
    room.actionTimer = setTimeout(() => {
      try {
        const current = room.engine;
        if (!current || current.isComplete || current.actingSeat !== acting.seat) return;
        if (acting.isBot) {
          const decision = decideAiAction(current, acting.identityId, acting.difficulty ?? 'normal');
          current.applyAction(acting.identityId, decision);
        } else {
          const legal = current.getLegalActions(acting.identityId);
          if (!legal) return;
          // 基础时限用完后，在线玩家自动进入时间银行，而不是直接托管。
          if (!room.timeBank && acting.connected && acting.timeBankMs > 0) {
            room.timeBank = { identityId: acting.identityId, startedAt: Date.now() };
            this.armActionTimer(room, acting, acting.timeBankMs);
            this.broadcast(room);
            return;
          }
          current.applyAction(acting.identityId, { type: legal.canCheck ? 'check' : 'fold' });
          acting.consecutiveTimeouts += 1;
          if (room.config.mode === 'cash' && !acting.sittingOut && acting.consecutiveTimeouts >= AUTO_SIT_OUT_TIMEOUTS) {
            this.markSittingOut(room, acting);
            this.addSystemMessage(room, `${acting.name} 连续超时，已自动暂离`);
          }
        }
        this.scheduleTurn(room);
      } catch (error) {
        this.io.to(this.channel(room.id)).emit('app:error', {
          message: error instanceof Error ? error.message : '自动操作失败',
        });
      }
    }, delay);
  }

  /** 行动结束（主动或超时）后，从对应座位扣除已用的时间银行。 */
  private settleTimeBank(room: LiveRoom): void {
    if (!room.timeBank) return;
    const seat = room.seats.get(room.timeBank.identityId);
    if (seat) seat.timeBankMs = Math.max(0, seat.timeBankMs - (Date.now() - room.timeBank.startedAt));
    room.timeBank = null;
  }

  private markSittingOut(room: LiveRoom, seat: LiveSeat): void {
    seat.sittingOut = true;
    seat.sitOutSince = Date.now();
  }

  private completeHand(room: LiveRoom): void {
    const engine = room.engine;
    if (!engine?.result || this.persistedHands.has(engine.handId) || !room.gameSessionId) return;
    this.persistedHands.add(engine.handId);
    this.syncStacksFromEngine(room, engine);
    if (this.isRankedCash(room)) {
      for (const seat of room.seats.values()) {
        if (seat.stakeId) {
          this.bankroll.checkpointStake(seat.stakeId, seat.stack);
          if (seat.userId) this.notifyWallet(seat.userId);
        }
      }
    }
    room.actionDeadline = null;
    if (this.timing.timeBankMs > 0) {
      for (const seat of room.seats.values()) {
        if (!seat.isBot) seat.timeBankMs = Math.min(TIME_BANK_MAX_MS, seat.timeBankMs + TIME_BANK_REFILL_MS);
      }
    }
    room.resultMessage = engine.result.resultText;
    const completedAt = Date.now();
    const durationSeconds = Math.min(30, Math.max(3, this.showdownDurationSeconds()));
    room.showdown = {
      handId: engine.handId,
      resultText: engine.result.resultText,
      completedAt,
      displayUntil: completedAt + durationSeconds * 1_000,
      winners: engine.result.payouts
        .filter((payout) => payout.reason !== '未被跟注筹码退回')
        .map((payout) => {
          const player = engine.getPlayer(payout.playerId);
          const revealed = Boolean(player && engine.phase === 'showdown' && !player.folded);
          return {
            playerId: payout.playerId,
            name: player?.name ?? payout.playerId,
            amount: payout.amount,
            reason: payout.reason,
            handName: revealed ? payout.handName : null,
            holeCards: revealed ? (player?.holeCards.map((card) => ({ rank: card.rank, suit: card.suit })) ?? []) : [],
            revealed,
          };
        }),
    };
    const participants: PersistedParticipant[] = engine.players.map((player) => {
      const seat = room.seats.get(player.id);
      if (!seat) throw new Error('牌谱玩家不存在');
      return {
        identityId: seat.identityId,
        userId: seat.userId,
        name: seat.name,
        seat: seat.seat,
        holeCards: player.holeCards,
        shown: engine.phase === 'showdown' && !player.folded,
        startingStack: room.handStartStacks.get(player.id) ?? 0,
        endingStack: player.stack,
      };
    });
    this.persistence.persistHand({
      id: engine.handId,
      gameSessionId: room.gameSessionId,
      roomId: room.id,
      roomName: room.config.name,
      mode: room.config.mode,
      ranked: room.config.ranked,
      handNumber: room.handNumber,
      board: engine.board,
      pot: engine.pot,
      smallBlind: engine.smallBlind,
      bigBlind: engine.bigBlind,
      resultText: engine.result.resultText,
      startedAt: room.handStartedAt ?? Date.now(),
      completedAt,
      actions: engine.actions,
      participants,
    });

    if (room.config.mode === 'tournament') {
      for (const seat of room.seats.values()) if (seat.forfeited) seat.stack = 0;
      this.updateTournamentPlacements(room);
      const alive = [...room.seats.values()].filter((seat) => seat.stack > 0);
      if (alive.length === 1) {
        const champion = alive[0]!;
        champion.placement = 1;
        const championEntry = room.tournamentEntries.get(champion.identityId);
        if (championEntry) championEntry.placement = 1;
        room.status = 'finished';
        room.resultMessage = `🏆 ${champion.name} 获得锦标赛冠军`;
        if (room.config.ranked) {
          const standings: TournamentStanding[] = [...room.tournamentEntries.values()].map((entry) => ({
            userId: entry.userId,
            place: entry.placement ?? room.tournamentEntries.size,
            players: room.tournamentEntries.size,
          }));
          this.persistence.recordTournamentResults(standings);
        }
        for (const seat of [...room.seats.values()]) {
          if (seat.stack === 0 && !seat.isBot) {
            const member = room.members.get(seat.identityId);
            if (member?.connected) this.removeSeat(room, seat.identityId, true);
            else this.removeMember(room, seat.identityId);
          }
        }
        this.persistence.finishGameSession(room.gameSessionId);
        this.addSystemMessage(room, room.resultMessage);
        this.broadcast(room);
        this.lobbyChanged();
        return;
      }
      for (const seat of [...room.seats.values()]) {
        if (seat.stack === 0 && !seat.isBot) {
          const member = room.members.get(seat.identityId);
          if (member?.connected) this.removeSeat(room, seat.identityId, true);
          else this.removeMember(room, seat.identityId);
        }
      }
    } else {
      for (const seat of room.seats.values()) {
        if (seat.isBot && seat.stack === 0) seat.stack = this.startingStack(room);
      }
      for (const seat of [...room.seats.values()]) {
        if (!seat.leavingAfterHand) continue;
        if (seat.exitAfterHand) this.removeMember(room, seat.identityId);
        else this.removeSeat(room, seat.identityId, true);
      }
    }

    if (!this.rooms.has(room.id)) return;
    this.broadcast(room);
    room.transitionTimer = setTimeout(() => this.startHand(room), durationSeconds * 1_000);
  }

  private updateTournamentPlacements(room: LiveRoom): void {
    const eliminated = [...room.seats.values()]
      .filter((seat) => seat.stack === 0 && seat.placement === null)
      .sort(
        (left, right) =>
          (room.handStartStacks.get(left.identityId) ?? 0) - (room.handStartStacks.get(right.identityId) ?? 0) ||
          right.seat - left.seat,
      );
    const remaining = [...room.seats.values()].filter((seat) => seat.stack > 0).length;
    eliminated.forEach((seat, index) => {
      if (seat.placement === null) seat.placement = remaining + eliminated.length - index;
      const entry = room.tournamentEntries.get(seat.identityId);
      if (entry && entry.placement === null) entry.placement = seat.placement;
    });
  }

  private forfeitTournamentSeat(room: LiveRoom, seat: LiveSeat, exitRoom: boolean): void {
    if (seat.forfeited) return;
    const place = [...room.seats.values()].filter((candidate) => candidate.stack > 0 && !candidate.forfeited).length;
    seat.placement = place;
    seat.forfeited = true;
    seat.leavingAfterHand = true;
    seat.exitAfterHand = exitRoom;
    const entry = room.tournamentEntries.get(seat.identityId);
    if (entry) entry.placement = place;
    this.addSystemMessage(room, `${seat.name} 离座并以第 ${place} 名弃赛`);

    const activeHand = room.engine && !room.engine.isComplete && room.engine.getPlayer(seat.identityId);
    if (activeHand) {
      if (room.engine?.actingSeat === seat.seat) {
        room.engine.applyAction(seat.identityId, { type: 'fold' });
        this.scheduleTurn(room);
      }
      if (exitRoom) this.removeMember(room, seat.identityId, true);
    } else {
      seat.stack = 0;
      if (exitRoom) this.removeMember(room, seat.identityId);
      else this.removeSeat(room, seat.identityId, true);
      this.finishTournamentAfterDeparture(room);
    }
    if (this.rooms.has(room.id)) {
      this.broadcast(room);
      this.lobbyChanged();
    }
  }

  private finishTournamentAfterDeparture(room: LiveRoom): boolean {
    if (room.config.mode !== 'tournament' || room.status !== 'playing') return false;
    const alive = [...room.seats.values()].filter((seat) => seat.stack > 0 && !seat.forfeited);
    if (alive.length !== 1) return false;
    const champion = alive[0]!;
    champion.placement = 1;
    const championEntry = room.tournamentEntries.get(champion.identityId);
    if (championEntry) championEntry.placement = 1;
    room.status = 'finished';
    room.resultMessage = `🏆 ${champion.name} 获得锦标赛冠军`;
    if (room.transitionTimer) clearTimeout(room.transitionTimer);
    room.transitionTimer = null;
    if (room.config.ranked) {
      this.persistence.recordTournamentResults([...room.tournamentEntries.values()].map((entry) => ({
        userId: entry.userId,
        place: entry.placement ?? room.tournamentEntries.size,
        players: room.tournamentEntries.size,
      })));
    }
    if (room.gameSessionId) this.persistence.finishGameSession(room.gameSessionId);
    this.addSystemMessage(room, room.resultMessage);
    return true;
  }

  private currentBlinds(room: LiveRoom): [number, number] {
    if (room.config.mode === 'cash') return [room.config.smallBlind, room.config.bigBlind];
    const elapsed = Math.max(0, Date.now() - (room.tournamentStartedAt ?? Date.now()));
    const level = Math.min(TOURNAMENT_BLINDS.length - 1, Math.floor(elapsed / 300_000));
    const blinds = TOURNAMENT_BLINDS[level] ?? TOURNAMENT_BLINDS[TOURNAMENT_BLINDS.length - 1]!;
    return [blinds[0], blinds[1]];
  }

  private tournamentLevel(room: LiveRoom): number | null {
    if (room.config.mode !== 'tournament' || room.tournamentStartedAt === null) return null;
    return Math.min(TOURNAMENT_BLINDS.length, Math.floor((Date.now() - room.tournamentStartedAt) / 300_000) + 1);
  }

  private syncStacksFromEngine(room: LiveRoom, engine: HoldemEngine): void {
    for (const player of engine.players) {
      const seat = room.seats.get(player.id);
      if (seat) seat.stack = player.stack;
    }
  }

  private maybeResumeCash(room: LiveRoom): void {
    if (room.config.mode !== 'cash' || room.status !== 'playing') return;
    if (room.transitionTimer || (room.engine && !room.engine.isComplete)) return;
    const eligible = [...room.seats.values()].filter(
      (seat) => seat.stack > 0 && !seat.leavingAfterHand && !seat.sittingOut && (seat.isBot || seat.connected),
    );
    if (eligible.length >= 2 && eligible.some((seat) => !seat.isBot)) room.transitionTimer = setTimeout(() => this.startHand(room), 700);
  }

  private addMember(room: LiveRoom, auth: AuthUser): LiveMember {
    const existing = room.members.get(auth.identityId);
    if (existing) return existing;
    const member: LiveMember = {
      identityId: auth.identityId,
      userId: auth.userId,
      name: auth.displayName,
      avatarUrl: auth.avatarUrl,
      isGuest: auth.isGuest,
      connected: false,
      socketIds: new Set(),
    };
    room.members.set(auth.identityId, member);
    this.identityRooms.set(auth.identityId, room.id);
    room.reconnectTimers.set(auth.identityId, setTimeout(() => this.handleReconnectExpired(room.id, auth.identityId), config.reconnectGraceMs));
    return member;
  }

  private addHumanSeat(room: LiveRoom, auth: AuthUser, seatNumber = this.firstOpenSeat(room), buyInBb?: number): void {
    const buyInChips = this.isRankedCash(room) ? this.validateBuyIn(room, buyInBb) : this.startingStack(room);
    if (this.isRankedCash(room) && (!auth.userId || auth.isGuest)) throw new Error('排位房仅允许注册用户买入');
    const stake = this.isRankedCash(room)
      ? this.bankroll.openStake({
          userId: auth.userId!,
          identityId: auth.identityId,
          roomId: room.id,
          buyInChips,
        })
      : null;
    const member = this.addMember(room, auth);
    room.seats.set(auth.identityId, {
      identityId: auth.identityId,
      userId: auth.userId,
      name: member.name,
      seat: seatNumber,
      stack: buyInChips,
      isBot: false,
      difficulty: null,
      connected: member.connected,
      socketIds: new Set(member.socketIds),
      leavingAfterHand: false,
      placement: null,
      avatarUrl: member.avatarUrl,
      isGuest: member.isGuest,
      exitAfterHand: false,
      forfeited: false,
      buyInChips: stake ? buyInChips : null,
      stakeId: stake?.id ?? null,
      sittingOut: false,
      sitOutSince: null,
      consecutiveTimeouts: 0,
      timeBankMs: this.timing.timeBankMs,
    });
    if (auth.userId && stake) this.notifyWallet(auth.userId);
  }

  private addBotInternal(room: LiveRoom, difficulty: AiDifficulty): LiveSeat {
    const botNumber = [...room.seats.values()].filter((seat) => seat.isBot).length + 1;
    const identityId = `bot:${randomUUID()}`;
    const labels: Record<AiDifficulty, string> = { easy: '新手', normal: '稳健', hard: '高手' };
    const seat: LiveSeat = {
      identityId,
      userId: null,
      name: `AI·${labels[difficulty]}${botNumber}`,
      seat: this.firstOpenSeat(room),
      stack: this.startingStack(room),
      isBot: true,
      difficulty,
      connected: true,
      socketIds: new Set(),
      leavingAfterHand: false,
      placement: null,
      avatarUrl: '/api/avatars/preset/club',
      isGuest: false,
      exitAfterHand: false,
      forfeited: false,
      buyInChips: null,
      stakeId: null,
      sittingOut: false,
      sitOutSince: null,
      consecutiveTimeouts: 0,
      timeBankMs: 0,
    };
    room.seats.set(identityId, seat);
    return seat;
  }

  private replaceAvailableBot(room: LiveRoom): boolean {
    if (room.config.ranked) return false;
    if (room.engine && !room.engine.isComplete) return false;
    const bot = [...room.seats.values()].find((seat) => seat.isBot);
    if (!bot) return false;
    this.removeSeat(room, bot.identityId);
    return true;
  }

  private removeSeat(room: LiveRoom, identityId: string, keepMember = false): void {
    const seat = room.seats.get(identityId);
    if (!seat) return;
    const reconnectTimer = room.reconnectTimers.get(identityId);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    room.reconnectTimers.delete(identityId);
    if (seat.stakeId && seat.userId) {
      this.bankroll.settleStake(seat.stakeId, seat.stack);
      seat.stakeId = null;
      this.notifyWallet(seat.userId);
    }
    room.seats.delete(identityId);
    if (!seat.isBot && !keepMember) this.removeMember(room, identityId, true);
    if (!seat.isBot && keepMember && !room.members.has(identityId) && room.members.size === 0 && (!room.engine || room.engine.isComplete)) {
      this.destroyRoom(room);
    }
  }

  private removeMember(room: LiveRoom, identityId: string, keepSeat = false): void {
    const member = room.members.get(identityId);
    if (!member) {
      if (!keepSeat) this.removeSeat(room, identityId, true);
      this.identityRooms.delete(identityId);
      if (room.members.size === 0 && (!room.engine || room.engine.isComplete || !keepSeat)) this.destroyRoom(room);
      return;
    }
    const reconnectTimer = room.reconnectTimers.get(identityId);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    room.reconnectTimers.delete(identityId);
    if (!keepSeat) this.removeSeat(room, identityId, true);
    room.members.delete(identityId);
    this.identityRooms.delete(identityId);
    if (room.hostId === identityId) {
      const nextHost = room.members.values().next().value as LiveMember | undefined;
      if (nextHost) room.hostId = nextHost.identityId;
    }
    if (room.members.size === 0 && (!room.engine || room.engine.isComplete || !keepSeat)) this.destroyRoom(room);
  }

  private handleReconnectExpired(roomId: string, identityId: string): void {
    const room = this.rooms.get(roomId);
    const member = room?.members.get(identityId);
    const seat = room?.seats.get(identityId);
    if (!room || !member || member.connected) return;
    room.reconnectTimers.delete(identityId);
    if (!seat) {
      this.removeMember(room, identityId);
      this.broadcast(room);
      this.lobbyChanged();
      return;
    }
    if (room.config.mode === 'tournament' && room.status === 'playing') {
      this.broadcast(room);
      return;
    }
    if (room.engine && !room.engine.isComplete && room.engine.getPlayer(identityId)) {
      seat.leavingAfterHand = true;
      seat.exitAfterHand = true;
      this.removeMember(room, identityId, true);
    } else this.removeMember(room, identityId);
    this.broadcast(room);
    this.lobbyChanged();
  }

  private destroyRoom(room: LiveRoom): void {
    if (room.actionTimer) clearTimeout(room.actionTimer);
    if (room.transitionTimer) clearTimeout(room.transitionTimer);
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    for (const timer of room.reconnectTimers.values()) clearTimeout(timer);
    for (const seat of room.seats.values()) {
      if (seat.stakeId && seat.userId) {
        this.bankroll.settleStake(seat.stakeId, seat.stack);
        this.notifyWallet(seat.userId);
      }
    }
    room.seats.clear();
    for (const member of room.members.values()) this.identityRooms.delete(member.identityId);
    if (room.gameSessionId && room.status !== 'finished') this.persistence.finishGameSession(room.gameSessionId, 'abandoned');
    this.rooms.delete(room.id);
    this.lobbyChanged();
  }

  private startingStack(room: LiveRoom): number {
    return room.config.mode === 'tournament' ? 1_500 : room.config.bigBlind * room.config.startingStackBb;
  }

  private isRankedCash(room: LiveRoom): boolean {
    return room.config.ranked && room.config.mode === 'cash';
  }

  private validateBuyIn(room: LiveRoom, buyInBb: number | undefined): number {
    if (!this.isRankedCash(room)) return this.startingStack(room);
    if (buyInBb === undefined || !Number.isInteger(buyInBb) || buyInBb % 10 !== 0) {
      throw new Error('请选择以 10 BB 为步长的买入量');
    }
    if (buyInBb < room.config.minBuyInBb || buyInBb > room.config.maxBuyInBb) {
      throw new Error(`买入须在 ${room.config.minBuyInBb}–${room.config.maxBuyInBb} BB 之间`);
    }
    return buyInBb * room.config.bigBlind;
  }

  private notifyWallet(userId: string): void {
    const wallet = this.bankroll.wallet(userId);
    for (const socket of this.io.sockets.sockets.values()) {
      if (socket.data.auth.userId === userId) socket.emit('wallet:updated', wallet);
    }
  }

  private firstOpenSeat(room: LiveRoom): number {
    for (let seat = 0; seat < room.config.maxSeats; seat += 1) {
      if (![...room.seats.values()].some((player) => player.seat === seat)) return seat;
    }
    throw new Error('没有空座位');
  }

  private nextDealer(previous: number | null, seats: LiveSeat[]): number {
    if (previous === null) return seats[0]?.seat ?? 0;
    for (let offset = 1; offset <= 9; offset += 1) {
      const candidate = (previous + offset) % 9;
      if (seats.some((seat) => seat.seat === candidate)) return candidate;
    }
    return seats[0]?.seat ?? 0;
  }

  private summary(room: LiveRoom, revealCode: boolean): PublicRoomSummary {
    const humans = [...room.seats.values()].filter((seat) => !seat.isBot).length;
    return {
      id: room.id,
      code: revealCode ? room.code : null,
      name: room.config.name,
      mode: room.config.mode,
      ranked: room.config.ranked,
      visibility: room.config.visibility,
      status: room.status,
      seated: room.seats.size,
      humans,
      maxSeats: room.config.maxSeats,
      targetPlayers: room.config.targetPlayers,
      smallBlind: room.engine?.smallBlind ?? room.config.smallBlind,
      bigBlind: room.engine?.bigBlind ?? room.config.bigBlind,
      hasAi: [...room.seats.values()].some((seat) => seat.isBot),
      spectators: Math.max(0, room.members.size - humans),
      minBuyInBb: this.isRankedCash(room) ? room.config.minBuyInBb : null,
      maxBuyInBb: this.isRankedCash(room) ? room.config.maxBuyInBb : null,
    };
  }

  private snapshot(room: LiveRoom, viewerId: string): GameSnapshot {
    const engine = room.engine;
    const events: GameEventView[] = (engine?.actions ?? []).slice(-14).map((action) => ({
      id: `${engine?.handId ?? 'room'}:${action.sequence}`,
      type: action.type,
      message: `${action.playerName} ${ACTION_NAMES[action.type] ?? action.type}${action.amount > 0 ? ` ${action.amount}` : ''}`,
      at: action.at,
    }));
    const players = [...room.seats.values()]
      .sort((left, right) => left.seat - right.seat)
      .map((seat) => {
        const inHand = engine?.getPlayer(seat.identityId);
        const reveal =
          inHand &&
          (seat.identityId === viewerId || (engine?.isComplete && engine.phase === 'showdown' && !inHand.folded));
        return {
          id: seat.identityId,
          userId: seat.userId,
          name: seat.name,
          seat: seat.seat,
          stack: inHand?.stack ?? seat.stack,
          committed: inHand?.committedHand ?? 0,
          folded: inHand?.folded ?? false,
          allIn: inHand?.allIn ?? false,
          connected: seat.connected,
          isBot: seat.isBot,
          aiDifficulty: seat.difficulty,
          isDealer: engine?.dealerSeat === seat.seat,
          isSmallBlind: engine?.smallBlindSeat === seat.seat,
          isBigBlind: engine?.bigBlindSeat === seat.seat,
          isActing: engine?.actingSeat === seat.seat,
          holeCards: inHand
            ? reveal
              ? inHand.holeCards.map((card) => ({ rank: card.rank, suit: card.suit }))
              : [{ rank: '', suit: '', hidden: true }, { rank: '', suit: '', hidden: true }]
            : [],
          placement: seat.placement,
          avatarUrl: seat.avatarUrl,
          leavingAfterHand: seat.leavingAfterHand,
          buyInChips: seat.buyInChips,
          sittingOut: seat.sittingOut,
          timeBankMs: seat.timeBankMs,
          usingTimeBank: room.timeBank?.identityId === seat.identityId,
        };
      });
    const occupiedSeats = new Set([...room.seats.values()].map((seat) => seat.seat));
    const viewerMember = room.members.get(viewerId);
    const viewerSeat = room.seats.get(viewerId);
    const viewerInHand = engine?.getPlayer(viewerId);
    const liveTableChips = viewerSeat?.stakeId
      ? (viewerInHand?.stack ?? viewerSeat.stack) + (engine && !engine.isComplete ? (viewerInHand?.committedHand ?? 0) : 0)
      : undefined;
    return {
      room: {
        ...this.summary(room, true),
        hostId: room.hostId,
        inviteCode: room.code,
        config: room.config,
      },
      selfId: viewerId,
      handId: engine?.handId ?? null,
      handNumber: room.handNumber,
      version: engine?.version ?? 0,
      phase: room.status === 'waiting' || room.status === 'countdown' ? room.status : engine?.phase ?? room.status,
      board: engine?.board.map((card) => ({ rank: card.rank, suit: card.suit })) ?? [],
      pot: engine?.pot ?? 0,
      currentBet: engine?.currentBet ?? 0,
      dealerSeat: engine?.dealerSeat ?? room.dealerSeat,
      smallBlindSeat: engine?.smallBlindSeat ?? null,
      bigBlindSeat: engine?.bigBlindSeat ?? null,
      actingSeat: engine?.actingSeat ?? null,
      actionDeadline: room.actionDeadline,
      countdownDeadline: room.countdownDeadline,
      players,
      legalActions: engine?.getLegalActions(viewerId) ?? null,
      events,
      tournamentLevel: this.tournamentLevel(room),
      tournamentElapsedMs:
        room.tournamentStartedAt === null ? null : Math.max(0, Date.now() - room.tournamentStartedAt),
      resultMessage: room.resultMessage,
      selfRole: room.seats.has(viewerId) ? 'player' : 'spectator',
      spectatorCount: Math.max(0, room.members.size - [...room.seats.values()].filter((seat) => !seat.isBot).length),
      openSeats: Array.from({ length: room.config.maxSeats }, (_, seat) => seat).filter((seat) => !occupiedSeats.has(seat)),
      showdown: room.showdown,
      selfWallet: viewerMember?.userId
        ? this.bankroll.wallet(viewerMember.userId, liveTableChips)
        : null,
    };
  }

  private emitSnapshot(room: LiveRoom, socket: PokerSocket): void {
    socket.emit('room:snapshot', this.snapshot(room, socket.data.auth.identityId));
  }

  private broadcast(room: LiveRoom): void {
    for (const member of room.members.values()) {
      for (const socketId of member.socketIds) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) this.emitSnapshot(room, socket);
      }
    }
  }

  private addSystemMessage(room: LiveRoom, text: string): void {
    const message: ChatMessage = {
      id: randomUUID(),
      senderId: 'system',
      senderName: '系统',
      text,
      createdAt: Date.now(),
      system: true,
    };
    room.chat.push(message);
    if (room.chat.length > 50) room.chat.shift();
    this.io.to(this.channel(room.id)).emit('room:chat', message);
  }

  private requireRoom(roomId: string): LiveRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('房间不存在');
    return room;
  }

  private requireHost(auth: AuthUser, roomId: string): LiveRoom {
    const room = this.requireRoom(roomId);
    if (room.hostId !== auth.identityId) throw new Error('只有房主可以执行该操作');
    return room;
  }

  private findRoom(idOrCode: string): LiveRoom | undefined {
    return this.rooms.get(idOrCode) ?? [...this.rooms.values()].find((room) => room.code === idOrCode.toUpperCase());
  }

  private lobbyChanged(): void {
    this.io.emit('lobby:updated');
  }

  private channel(roomId: string): string {
    return `room:${roomId}`;
  }
}

export function withAck<T>(callback: ((value: Ack) => void) | undefined, operation: () => T): T | undefined {
  try {
    const result = operation();
    safeCallback(callback, { ok: true });
    return result;
  } catch (error) {
    safeCallback(callback, { ok: false, error: error instanceof Error ? error.message : '操作失败' });
    return undefined;
  }
}
