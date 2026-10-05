import { randomUUID } from 'node:crypto';
import type {
  GameMode,
  HandHistoryDetail,
  HandHistorySummary,
  LeaderboardEntry,
  PlayerStatsView,
  RoomConfig,
  StatsMode,
} from '@poker/contracts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { cardCode, type Card, type EngineAction } from '@poker/game-engine';
import { config } from './config.js';
import { avatarUrl } from './avatar.js';
import type { PokerDatabase } from './db/index.js';
import { computePlayerStats, type StatsAction } from './stats.js';
import {
  gameSessions,
  handActions,
  handParticipants,
  hands,
  leaderboardEntries,
  reports,
  seasons,
  users,
} from './db/schema.js';

export interface PersistedParticipant {
  identityId: string;
  userId: string | null;
  name: string;
  seat: number;
  holeCards: Card[];
  shown: boolean;
  startingStack: number;
  endingStack: number;
}

export interface PersistHandInput {
  id: string;
  gameSessionId: string;
  roomId: string;
  roomName: string;
  mode: GameMode;
  ranked: boolean;
  handNumber: number;
  board: Card[];
  pot: number;
  smallBlind: number;
  bigBlind: number;
  resultText: string;
  startedAt: number;
  completedAt: number;
  actions: EngineAction[];
  participants: PersistedParticipant[];
}

export interface TournamentStanding {
  userId: string | null;
  place: number;
  players: number;
}

export class PersistenceService {
  constructor(private readonly db: PokerDatabase) {}

  currentSeason(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: config.appTimezone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === 'year')?.value ?? now.getUTCFullYear());
    const month = Number(parts.find((part) => part.type === 'month')?.value ?? now.getUTCMonth() + 1);
    const id = `${year}-${String(month).padStart(2, '0')}`;
    this.db
      .insert(seasons)
      .values({
        id,
        name: `${year} 年 ${month} 月赛季`,
        startsAt: Date.UTC(year, month - 1, 1),
        endsAt: Date.UTC(year, month, 1) - 1,
      })
      .onConflictDoNothing()
      .run();
    return id;
  }

  createGameSession(input: {
    id: string;
    roomId: string;
    roomName: string;
    mode: GameMode;
    ranked: boolean;
    config: RoomConfig;
    startedAt: number;
  }): void {
    this.db
      .insert(gameSessions)
      .values({
        id: input.id,
        roomId: input.roomId,
        roomName: input.roomName,
        mode: input.mode,
        ranked: input.ranked,
        configJson: JSON.stringify(input.config),
        startedAt: input.startedAt,
        status: 'active',
      })
      .run();
  }

  finishGameSession(id: string, status = 'completed'): void {
    this.db.update(gameSessions).set({ endedAt: Date.now(), status }).where(eq(gameSessions.id, id)).run();
  }

  persistHand(input: PersistHandInput): void {
    this.db.transaction((transaction) => {
      transaction
        .insert(hands)
        .values({
          id: input.id,
          gameSessionId: input.gameSessionId,
          roomId: input.roomId,
          roomName: input.roomName,
          mode: input.mode,
          ranked: input.ranked,
          handNumber: input.handNumber,
          boardJson: JSON.stringify(input.board.map(cardCode)),
          pot: input.pot,
          smallBlind: input.smallBlind,
          bigBlind: input.bigBlind,
          resultText: input.resultText,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
        })
        .run();

      if (input.actions.length > 0) {
        transaction
          .insert(handActions)
          .values(
            input.actions.map((action) => ({
              id: randomUUID(),
              handId: input.id,
              sequence: action.sequence,
              playerId: action.playerId,
              playerName: action.playerName,
              street: action.street,
              action: action.type,
              amount: action.amount,
              createdAt: action.at,
            })),
          )
          .run();
      }

      transaction
        .insert(handParticipants)
        .values(
          input.participants.map((participant) => ({
            id: randomUUID(),
            handId: input.id,
            identityId: participant.identityId,
            userId: participant.userId,
            name: participant.name,
            seat: participant.seat,
            holeCardsJson: JSON.stringify(participant.holeCards.map(cardCode)),
            shown: participant.shown,
            startingStack: participant.startingStack,
            endingStack: participant.endingStack,
            netChips: participant.endingStack - participant.startingStack,
          })),
        )
        .run();

      if (input.ranked && input.mode === 'cash') {
        const seasonId = this.currentSeason(new Date(input.completedAt));
        for (const participant of input.participants) {
          if (!participant.userId) continue;
          const points = (participant.endingStack - participant.startingStack) / input.bigBlind;
          this.upsertLeaderboard(transaction, seasonId, participant.userId, {
            cashPoints: points,
            tournamentPoints: 0,
            cashHands: 1,
            tournaments: 0,
            wins: 0,
          });
        }
      }
    });
  }

  recordTournamentResults(standings: TournamentStanding[], completedAt = Date.now()): void {
    const seasonId = this.currentSeason(new Date(completedAt));
    this.db.transaction((transaction) => {
      for (const standing of standings) {
        if (!standing.userId) continue;
        const points = standing.players <= 1 ? 20 : (20 * (standing.players - standing.place)) / (standing.players - 1);
        this.upsertLeaderboard(transaction, seasonId, standing.userId, {
          cashPoints: 0,
          tournamentPoints: points,
          cashHands: 0,
          tournaments: 1,
          wins: standing.place === 1 ? 1 : 0,
        });
      }
    });
  }

  leaderboard(seasonId = this.currentSeason()): LeaderboardEntry[] {
    const rows = this.db
      .select({
        userId: leaderboardEntries.userId,
        displayName: users.displayName,
        avatarType: users.avatarType,
        avatarValue: users.avatarValue,
        cashPoints: leaderboardEntries.cashPoints,
        tournamentPoints: leaderboardEntries.tournamentPoints,
        cashHands: leaderboardEntries.cashHands,
        tournaments: leaderboardEntries.tournaments,
        wins: leaderboardEntries.wins,
      })
      .from(leaderboardEntries)
      .innerJoin(users, eq(leaderboardEntries.userId, users.id))
      .where(eq(leaderboardEntries.seasonId, seasonId))
      .all()
      .map((row) => ({
        ...row,
        avatarUrl: avatarUrl(row.avatarType, row.avatarValue),
        totalPoints: row.cashPoints + row.tournamentPoints,
      }))
      .sort((left, right) => right.totalPoints - left.totalPoints || right.wins - left.wins);
    return rows.map(({ avatarType: _avatarType, avatarValue: _avatarValue, ...row }, index) => ({ ...row, rank: index + 1 }));
  }

  listHistory(identityId: string, limit = 50): HandHistorySummary[] {
    return this.db
      .select({
        id: hands.id,
        roomName: hands.roomName,
        mode: hands.mode,
        ranked: hands.ranked,
        handNumber: hands.handNumber,
        pot: hands.pot,
        netChips: handParticipants.netChips,
        bigBlind: hands.bigBlind,
        completedAt: hands.completedAt,
        resultText: hands.resultText,
      })
      .from(handParticipants)
      .innerJoin(hands, eq(handParticipants.handId, hands.id))
      .where(eq(handParticipants.identityId, identityId))
      .orderBy(desc(hands.completedAt))
      .limit(Math.min(100, Math.max(1, limit)))
      .all()
      .map((row) => ({ ...row, mode: row.mode as GameMode }));
  }

  handDetail(identityId: string, handId: string): HandHistoryDetail | null {
    const own = this.db
      .select()
      .from(handParticipants)
      .where(and(eq(handParticipants.handId, handId), eq(handParticipants.identityId, identityId)))
      .get();
    if (!own) return null;
    const hand = this.db.select().from(hands).where(eq(hands.id, handId)).get();
    if (!hand) return null;
    const participants = this.db.select().from(handParticipants).where(eq(handParticipants.handId, handId)).all();
    const session = this.db.select({ configJson: gameSessions.configJson }).from(gameSessions).where(eq(gameSessions.id, hand.gameSessionId)).get();
    let maxSeats = Math.max(2, ...participants.map((participant) => participant.seat + 1));
    try {
      const seats = session ? (JSON.parse(session.configJson) as Partial<RoomConfig>).maxSeats : undefined;
      if (typeof seats === 'number' && seats >= maxSeats) maxSeats = seats;
    } catch {
      // 旧数据的配置无法解析时，按实际座位号推算。
    }
    const actions = this.db
      .select()
      .from(handActions)
      .where(eq(handActions.handId, handId))
      .orderBy(handActions.sequence)
      .all();
    return {
      id: hand.id,
      roomName: hand.roomName,
      mode: hand.mode as GameMode,
      ranked: hand.ranked,
      handNumber: hand.handNumber,
      pot: hand.pot,
      netChips: own.netChips,
      bigBlind: hand.bigBlind,
      completedAt: hand.completedAt,
      resultText: hand.resultText,
      board: (JSON.parse(hand.boardJson) as string[]).map(this.cardView),
      smallBlind: hand.smallBlind,
      maxSeats,
      players: participants.map((participant) => ({
        id: participant.identityId,
        name: participant.name,
        seat: participant.seat,
        holeCards:
          participant.identityId === identityId || participant.shown
            ? (JSON.parse(participant.holeCardsJson) as string[]).map(this.cardView)
            : [{ rank: '', suit: '', hidden: true }, { rank: '', suit: '', hidden: true }],
        shown: participant.shown || participant.identityId === identityId,
        startingStack: participant.startingStack,
        netChips: participant.netChips,
      })),
      actions: actions.map((action) => ({
        sequence: action.sequence,
        playerId: action.playerId,
        playerName: action.playerName,
        street: action.street,
        action: action.action,
        amount: action.amount,
        createdAt: action.createdAt,
      })),
    };
  }

  /** 统计某个身份最近 limit 手牌的技术数据。 */
  playerStats(identityId: string, mode: StatsMode = 'all', limit = 1_000): PlayerStatsView {
    const condition = mode === 'all'
      ? eq(handParticipants.identityId, identityId)
      : and(eq(handParticipants.identityId, identityId), eq(hands.mode, mode));
    const rows = this.db
      .select({
        handId: hands.id,
        mode: hands.mode,
        bigBlind: hands.bigBlind,
        completedAt: hands.completedAt,
        pot: hands.pot,
        boardJson: hands.boardJson,
        netChips: handParticipants.netChips,
        shown: handParticipants.shown,
      })
      .from(handParticipants)
      .innerJoin(hands, eq(handParticipants.handId, hands.id))
      .where(condition)
      .orderBy(desc(hands.completedAt))
      .limit(limit)
      .all();
    const actionsByHand = new Map<string, StatsAction[]>();
    // 分批读取，避免 IN 列表过长。
    for (let start = 0; start < rows.length; start += 500) {
      const ids = rows.slice(start, start + 500).map((row) => row.handId);
      const actions = this.db
        .select({ handId: handActions.handId, playerId: handActions.playerId, street: handActions.street, action: handActions.action, amount: handActions.amount })
        .from(handActions)
        .where(inArray(handActions.handId, ids))
        .orderBy(asc(handActions.handId), asc(handActions.sequence))
        .all();
      for (const { handId, ...action } of actions) {
        const list = actionsByHand.get(handId) ?? [];
        list.push(action);
        actionsByHand.set(handId, list);
      }
    }
    return computePlayerStats(identityId, rows.map((row) => ({
      handId: row.handId,
      mode: row.mode as GameMode,
      bigBlind: row.bigBlind,
      completedAt: row.completedAt,
      pot: row.pot,
      boardCount: (JSON.parse(row.boardJson) as string[]).length,
      netChips: row.netChips,
      shown: row.shown,
      actions: actionsByHand.get(row.handId) ?? [],
    })));
  }

  saveReport(input: {
    reporterIdentityId: string;
    roomId: string;
    messageId: string;
    senderIdentityId: string;
    messageText: string;
  }): void {
    this.db.insert(reports).values({ id: randomUUID(), ...input, createdAt: Date.now(), status: 'open' }).run();
  }

  private cardView(code: string): { rank: string; suit: string } {
    return { rank: code[0] ?? '', suit: code[1] ?? '' };
  }

  private upsertLeaderboard(
    transaction: Parameters<Parameters<PokerDatabase['transaction']>[0]>[0],
    seasonId: string,
    userId: string,
    delta: {
      cashPoints: number;
      tournamentPoints: number;
      cashHands: number;
      tournaments: number;
      wins: number;
    },
  ): void {
    transaction
      .insert(leaderboardEntries)
      .values({
        id: randomUUID(),
        seasonId,
        userId,
        ...delta,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [leaderboardEntries.seasonId, leaderboardEntries.userId],
        set: {
          cashPoints: sql`${leaderboardEntries.cashPoints} + ${delta.cashPoints}`,
          tournamentPoints: sql`${leaderboardEntries.tournamentPoints} + ${delta.tournamentPoints}`,
          cashHands: sql`${leaderboardEntries.cashHands} + ${delta.cashHands}`,
          tournaments: sql`${leaderboardEntries.tournaments} + ${delta.tournaments}`,
          wins: sql`${leaderboardEntries.wins} + ${delta.wins}`,
          updatedAt: Date.now(),
        },
      })
      .run();
  }
}
