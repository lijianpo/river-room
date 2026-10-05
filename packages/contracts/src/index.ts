import { z } from 'zod';

export const gameModeSchema = z.enum(['cash', 'tournament']);
export const roomVisibilitySchema = z.enum(['public', 'private']);
export const aiDifficultySchema = z.enum(['easy', 'normal', 'hard']);
export const roomStatusSchema = z.enum(['waiting', 'countdown', 'playing', 'finished']);
export const buyInBbSchema = z
  .number()
  .int()
  .min(40)
  .max(200)
  .refine((value) => value % 10 === 0, '买入必须以 10 BB 为步长');
export const playerActionTypeSchema = z.enum([
  'fold',
  'check',
  'call',
  'bet',
  'raise',
  'all_in',
]);

/** 牌桌表情，客户端负责映射到具体的 emoji。 */
export const emoteIdSchema = z.enum(['thumbs_up', 'laugh', 'wow', 'cry', 'angry', 'think', 'fire', 'gg']);

export type GameMode = z.infer<typeof gameModeSchema>;
export type RoomVisibility = z.infer<typeof roomVisibilitySchema>;
export type AiDifficulty = z.infer<typeof aiDifficultySchema>;
export type RoomStatus = z.infer<typeof roomStatusSchema>;
export type PlayerActionType = z.infer<typeof playerActionTypeSchema>;
export type EmoteId = z.infer<typeof emoteIdSchema>;
export type AccountStatus = 'active' | 'disabled';
export type RoomRole = 'player' | 'spectator';

export const roomConfigSchema = z
  .object({
    name: z.string().trim().min(2).max(24),
    mode: gameModeSchema,
    visibility: roomVisibilitySchema,
    ranked: z.boolean().default(false),
    maxSeats: z.number().int().min(2).max(9),
    targetPlayers: z.number().int().min(2).max(9),
    smallBlind: z.number().int().min(1).max(10_000).default(10),
    bigBlind: z.number().int().min(2).max(20_000).default(20),
    startingStackBb: z.number().int().min(40).max(200).default(100),
    minBuyInBb: buyInBbSchema.default(40),
    maxBuyInBb: buyInBbSchema.default(200),
    autoFillAi: z.boolean().default(false),
    aiDifficulty: aiDifficultySchema.default('normal'),
  })
  .superRefine((value, context) => {
    if (value.targetPlayers > value.maxSeats) {
      context.addIssue({
        code: 'custom',
        path: ['targetPlayers'],
        message: '目标人数不能超过座位数',
      });
    }
    if (value.smallBlind >= value.bigBlind) {
      context.addIssue({
        code: 'custom',
        path: ['smallBlind'],
        message: '小盲必须小于大盲',
      });
    }
    if (value.ranked && value.visibility !== 'public') {
      context.addIssue({ code: 'custom', path: ['ranked'], message: '排位房必须公开' });
    }
    if (value.ranked && value.autoFillAi) {
      context.addIssue({ code: 'custom', path: ['autoFillAi'], message: '排位房不能启用 AI' });
    }
    if (value.minBuyInBb > value.maxBuyInBb) {
      context.addIssue({ code: 'custom', path: ['minBuyInBb'], message: '最小买入不能超过最大买入' });
    }
  });

export type RoomConfig = z.infer<typeof roomConfigSchema>;

export type CreateRoomRequest = RoomConfig & { buyInBb?: number };

export interface WalletView {
  availableChips: number;
  tableChips: number;
  totalChips: number;
  dailyBonusAmount: number;
  dailyBonusAvailable: boolean;
}

export type ChipTransactionType = 'initial' | 'daily_bonus' | 'buy_in' | 'cash_out' | 'recovery' | 'admin_adjustment';

export interface ChipTransactionView {
  id: string;
  type: ChipTransactionType;
  /** 正数为入账，负数为出账 */
  amount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: number;
}

export interface ChipTransactionPage {
  transactions: ChipTransactionView[];
  /** 下一页游标；为 null 表示没有更多记录 */
  nextCursor: string | null;
}

export const playerActionSchema = z.object({
  type: playerActionTypeSchema,
  amount: z.number().int().nonnegative().optional(),
  actionId: z.string().min(8).max(80),
  handId: z.string().min(1),
  version: z.number().int().nonnegative(),
});

export type PlayerAction = z.infer<typeof playerActionSchema>;

export interface AuthUser {
  identityId: string;
  userId: string | null;
  displayName: string;
  email: string | null;
  isGuest: boolean;
  avatarUrl: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  accountStatus: AccountStatus;
}

export interface PublicRoomSummary {
  id: string;
  code: string | null;
  name: string;
  mode: GameMode;
  ranked: boolean;
  visibility: RoomVisibility;
  status: RoomStatus;
  seated: number;
  humans: number;
  maxSeats: number;
  targetPlayers: number;
  smallBlind: number;
  bigBlind: number;
  hasAi: boolean;
  spectators: number;
  minBuyInBb: number | null;
  maxBuyInBb: number | null;
}

export interface RoomInvitePreview {
  name: string;
  mode: GameMode;
  ranked: boolean;
  visibility: RoomVisibility;
  status: RoomStatus;
  seated: number;
  maxSeats: number;
  spectators: number;
}

export interface CardView {
  rank: string;
  suit: string;
  hidden?: boolean;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number;
  minBet: number | null;
  minRaiseTo: number | null;
  maxAmount: number;
  canAllIn: boolean;
}

export interface PlayerSnapshot {
  id: string;
  userId: string | null;
  name: string;
  seat: number;
  stack: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  connected: boolean;
  isBot: boolean;
  aiDifficulty: AiDifficulty | null;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isActing: boolean;
  holeCards: CardView[];
  placement: number | null;
  avatarUrl: string;
  leavingAfterHand: boolean;
  buyInChips: number | null;
  /** 暂离中：保留座位但不参与发牌 */
  sittingOut: boolean;
  /** 剩余时间银行（毫秒） */
  timeBankMs: number;
  /** 当前行动是否已进入时间银行 */
  usingTimeBank: boolean;
}

export interface ShowdownWinnerView {
  playerId: string;
  name: string;
  amount: number;
  reason: string;
  handName: string | null;
  holeCards: CardView[];
  revealed: boolean;
}

export interface ShowdownResultView {
  handId: string;
  resultText: string;
  completedAt: number;
  displayUntil: number;
  winners: ShowdownWinnerView[];
}

export interface GameEventView {
  id: string;
  type: string;
  message: string;
  at: number;
}

export interface GameSnapshot {
  room: PublicRoomSummary & { hostId: string; inviteCode: string | null; config: RoomConfig };
  selfId: string;
  handId: string | null;
  handNumber: number;
  version: number;
  phase: string;
  board: CardView[];
  pot: number;
  currentBet: number;
  dealerSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  actingSeat: number | null;
  actionDeadline: number | null;
  countdownDeadline: number | null;
  players: PlayerSnapshot[];
  legalActions: LegalActions | null;
  events: GameEventView[];
  tournamentLevel: number | null;
  tournamentElapsedMs: number | null;
  resultMessage: string | null;
  selfRole: RoomRole;
  spectatorCount: number;
  openSeats: number[];
  showdown: ShowdownResultView | null;
  selfWallet: WalletView | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
  system?: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  cashPoints: number;
  tournamentPoints: number;
  totalPoints: number;
  cashHands: number;
  tournaments: number;
  wins: number;
  avatarUrl: string;
}

export interface PublicOverview {
  onlineCount: number;
  onlineGuests: number;
  season: string;
  entries: LeaderboardEntry[];
  generatedAt: number;
}

export interface AdminUserView {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  status: AccountStatus;
  online: boolean;
  mustChangePassword: boolean;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
  availableChips: number;
  tableChips: number;
  totalChips: number;
}

export interface AdminReportView {
  id: string;
  reporterIdentityId: string;
  roomId: string;
  messageId: string;
  senderIdentityId: string;
  messageText: string;
  createdAt: number;
  status: 'open' | 'resolved' | 'dismissed';
  resolvedBy: string | null;
  resolvedAt: number | null;
  resolutionNote: string | null;
}

export interface HandHistorySummary {
  id: string;
  roomName: string;
  mode: GameMode;
  ranked: boolean;
  handNumber: number;
  pot: number;
  netChips: number | null;
  bigBlind: number;
  completedAt: number;
  resultText: string;
}

export interface HandHistoryDetail extends HandHistorySummary {
  board: CardView[];
  smallBlind: number;
  /** 该手牌所在牌桌的座位数，用于回放时还原座位布局 */
  maxSeats: number;
  players: Array<{
    id: string;
    name: string;
    seat: number;
    holeCards: CardView[];
    shown: boolean;
    startingStack: number;
    netChips: number;
  }>;
  actions: Array<{
    sequence: number;
    playerId: string;
    playerName: string;
    street: string;
    action: string;
    amount: number;
    createdAt: number;
  }>;
}

export interface TableEmote {
  id: string;
  playerId: string;
  emote: EmoteId;
  at: number;
}

export const statsModeSchema = z.enum(['all', 'cash', 'tournament']);
export type StatsMode = z.infer<typeof statsModeSchema>;

/** 玩家技术统计；比率均为 0–1 的小数，样本不足以计算时为 null。 */
export interface PlayerStatsView {
  hands: number;
  /** 翻牌前主动入池率 */
  vpip: number | null;
  /** 翻牌前加注率 */
  pfr: number | null;
  /** 翻牌后激进度：（下注 + 加注）÷ 跟注 */
  aggressionFactor: number | null;
  /** 看到翻牌后进入摊牌的比例 */
  wtsd: number | null;
  /** 摊牌获胜率 */
  wsd: number | null;
  /** 净赢手数占比 */
  winRate: number | null;
  netChips: number;
  netBb: number;
  /** 常规桌每百手净赢大盲 */
  bbPer100: number | null;
  biggestPotWon: number;
  /** 最近若干手的累计净赢（BB），从 0 开始，按时间先后排列 */
  netCurve: number[];
}

export interface PlayerProfileView {
  userId: string;
  displayName: string;
  avatarUrl: string;
  stats: PlayerStatsView;
}

export interface ClientToServerEvents {
  'room:subscribe': (payload: { roomId: string }, callback?: (result: Ack) => void) => void;
  'room:leave': (payload: { roomId: string }, callback?: (result: Ack) => void) => void;
  'room:take-seat': (payload: { roomId: string; seat: number; buyInBb?: number }, callback?: (result: Ack) => void) => void;
  'room:stand-up': (payload: { roomId: string }, callback?: (result: Ack) => void) => void;
  'room:start': (payload: { roomId: string }, callback?: (result: Ack) => void) => void;
  'room:cancel-countdown': (payload: { roomId: string }, callback?: (result: Ack) => void) => void;
  'room:add-bot': (payload: { roomId: string; difficulty: AiDifficulty }, callback?: (result: Ack) => void) => void;
  'room:remove-bot': (payload: { roomId: string; playerId: string }, callback?: (result: Ack) => void) => void;
  'room:kick': (payload: { roomId: string; playerId: string }, callback?: (result: Ack) => void) => void;
  'room:sit-out': (payload: { roomId: string }, callback?: (result: Ack) => void) => void;
  'room:sit-in': (payload: { roomId: string }, callback?: (result: Ack) => void) => void;
  'room:rebuy': (payload: { roomId: string; buyInBb?: number }, callback?: (result: Ack) => void) => void;
  'game:action': (payload: { roomId: string; action: PlayerAction }, callback?: (result: Ack) => void) => void;
  'chat:send': (payload: { roomId: string; text: string }, callback?: (result: Ack) => void) => void;
  'room:emote': (payload: { roomId: string; emote: EmoteId }, callback?: (result: Ack) => void) => void;
  'chat:report': (payload: { roomId: string; messageId: string }, callback?: (result: Ack) => void) => void;
  'connection:ping': (payload: { nonce: string }, callback?: (result: PingAck) => void) => void;
}

export interface ServerToClientEvents {
  'room:snapshot': (snapshot: GameSnapshot) => void;
  'room:chat': (message: ChatMessage) => void;
  'room:chat-history': (messages: ChatMessage[]) => void;
  'room:emote': (emote: TableEmote) => void;
  'lobby:updated': () => void;
  'app:error': (payload: { message: string; code?: string }) => void;
  'wallet:updated': (wallet: WalletView) => void;
}

export interface Ack {
  ok: boolean;
  error?: string;
}

export interface PingAck {
  ok: true;
  nonce: string;
  serverTime: number;
}
