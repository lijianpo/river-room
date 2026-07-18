import type { LegalActions, PlayerActionType } from '@poker/contracts';
import { cardCode, shuffleDeck, type Card, type RandomSource } from './cards.js';
import { compareEvaluations, evaluateBest, type HandEvaluation } from './evaluator.js';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export interface EnginePlayerInput {
  id: string;
  name: string;
  seat: number;
  stack: number;
}

export interface EnginePlayer extends EnginePlayerInput {
  holeCards: Card[];
  committedStreet: number;
  committedHand: number;
  folded: boolean;
  allIn: boolean;
}

export interface EngineAction {
  sequence: number;
  playerId: string;
  playerName: string;
  street: Street;
  type: PlayerActionType | 'small_blind' | 'big_blind' | 'deal' | 'win';
  amount: number;
  at: number;
}

export interface Payout {
  playerId: string;
  amount: number;
  reason: string;
  handName: string | null;
}

export interface EngineResult {
  payouts: Payout[];
  evaluations: Record<string, HandEvaluation>;
  resultText: string;
}

export interface HoldemEngineOptions {
  handId: string;
  players: EnginePlayerInput[];
  dealerSeat: number;
  smallBlind: number;
  bigBlind: number;
  deck?: Card[];
  random?: RandomSource;
  now?: () => number;
}

export class HoldemEngine {
  readonly handId: string;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly players: EnginePlayer[];
  readonly board: Card[] = [];
  readonly actions: EngineAction[] = [];
  readonly dealerSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;

  phase: Street = 'preflop';
  currentBet = 0;
  minRaise: number;
  actingSeat: number | null = null;
  version = 0;
  result: EngineResult | null = null;

  private readonly deck: Card[];
  private readonly pendingSeats = new Set<number>();
  private readonly actedSinceFullRaise = new Set<number>();
  private readonly now: () => number;

  constructor(options: HoldemEngineOptions) {
    if (options.players.length < 2 || options.players.length > 9) {
      throw new Error('牌局需要 2 到 9 名玩家');
    }
    if (new Set(options.players.map((player) => player.seat)).size !== options.players.length) {
      throw new Error('玩家座位不能重复');
    }
    this.handId = options.handId;
    this.smallBlind = options.smallBlind;
    this.bigBlind = options.bigBlind;
    this.minRaise = options.bigBlind;
    this.now = options.now ?? Date.now;
    this.deck = options.deck ? options.deck.map((card) => ({ ...card })) : shuffleDeck(undefined, options.random);
    this.players = options.players
      .map((player) => ({
        ...player,
        holeCards: [],
        committedStreet: 0,
        committedHand: 0,
        folded: false,
        allIn: player.stack === 0,
      }))
      .sort((a, b) => a.seat - b.seat);

    const dealer = this.players.find((player) => player.seat === options.dealerSeat) ?? this.players[0];
    if (!dealer) throw new Error('找不到庄家');
    this.dealerSeat = dealer.seat;

    if (this.players.length === 2) {
      this.smallBlindSeat = this.dealerSeat;
      this.bigBlindSeat = this.nextSeat(this.dealerSeat, () => true);
    } else {
      this.smallBlindSeat = this.nextSeat(this.dealerSeat, () => true);
      this.bigBlindSeat = this.nextSeat(this.smallBlindSeat, () => true);
    }

    this.postBlind(this.smallBlindSeat, this.smallBlind, 'small_blind');
    this.postBlind(this.bigBlindSeat, this.bigBlind, 'big_blind');
    this.currentBet = Math.max(...this.players.map((player) => player.committedStreet));
    this.dealHoleCards();

    for (const player of this.actionablePlayers()) this.pendingSeats.add(player.seat);
    this.actingSeat = this.findNextPending(this.bigBlindSeat);
    this.actions.push({
      sequence: this.actions.length + 1,
      playerId: 'dealer',
      playerName: '荷官',
      street: 'preflop',
      type: 'deal',
      amount: 0,
      at: this.now(),
    });
    this.resolveAutomaticProgress();
  }

  get isComplete(): boolean {
    return this.result !== null;
  }

  get pot(): number {
    return this.players.reduce((sum, player) => sum + player.committedHand, 0);
  }

  getPlayer(playerId: string): EnginePlayer | undefined {
    return this.players.find((player) => player.id === playerId);
  }

  getLegalActions(playerId: string): LegalActions | null {
    const player = this.getPlayer(playerId);
    if (!player || this.isComplete || player.seat !== this.actingSeat || player.folded || player.allIn) return null;
    const toCall = Math.max(0, this.currentBet - player.committedStreet);
    const maximum = player.committedStreet + player.stack;
    const raiseRights = !this.actedSinceFullRaise.has(player.seat);
    const canRaise = raiseRights && maximum > this.currentBet;
    return {
      canFold: true,
      canCheck: toCall === 0,
      callAmount: Math.min(toCall, player.stack),
      minBet:
        this.currentBet === 0 && maximum >= this.bigBlind
          ? this.bigBlind
          : null,
      minRaiseTo:
        this.currentBet > 0 && canRaise && maximum >= this.currentBet + this.minRaise
          ? this.currentBet + this.minRaise
          : null,
      maxAmount: maximum,
      canAllIn: player.stack > 0 && (maximum <= this.currentBet || canRaise),
    };
  }

  applyAction(playerId: string, action: { type: PlayerActionType; amount?: number }): void {
    const player = this.getPlayer(playerId);
    if (!player || player.seat !== this.actingSeat || this.isComplete) throw new Error('现在不能执行该操作');
    const legal = this.getLegalActions(playerId);
    if (!legal) throw new Error('没有可用操作');
    const previousBet = this.currentBet;
    let loggedAmount = 0;
    let fullRaise = false;
    let raised = false;

    switch (action.type) {
      case 'fold':
        player.folded = true;
        break;
      case 'check':
        if (!legal.canCheck) throw new Error('当前不能过牌');
        break;
      case 'call': {
        if (legal.callAmount <= 0) throw new Error('当前无需跟注');
        loggedAmount = this.commit(player, legal.callAmount);
        break;
      }
      case 'bet': {
        if (this.currentBet !== 0) throw new Error('已有下注时必须加注');
        const target = action.amount;
        if (target === undefined || target <= 0 || target > legal.maxAmount) throw new Error('下注金额无效');
        if (target < this.bigBlind && target !== legal.maxAmount) throw new Error('下注低于最小下注');
        loggedAmount = this.commit(player, target - player.committedStreet);
        this.currentBet = player.committedStreet;
        raised = true;
        fullRaise = this.currentBet >= this.bigBlind;
        if (fullRaise) this.minRaise = this.currentBet;
        break;
      }
      case 'raise': {
        const target = action.amount;
        if (this.currentBet <= 0 || target === undefined || target <= this.currentBet || target > legal.maxAmount) {
          throw new Error('加注金额无效');
        }
        if (this.actedSinceFullRaise.has(player.seat)) throw new Error('不足额加注没有重新开放加注权');
        const increment = target - this.currentBet;
        if (increment < this.minRaise && target !== legal.maxAmount) throw new Error('加注低于最小加注');
        loggedAmount = this.commit(player, target - player.committedStreet);
        this.currentBet = player.committedStreet;
        raised = true;
        fullRaise = increment >= this.minRaise;
        if (fullRaise) this.minRaise = increment;
        break;
      }
      case 'all_in': {
        if (!legal.canAllIn) throw new Error('当前不能全押');
        const target = legal.maxAmount;
        loggedAmount = this.commit(player, player.stack);
        if (target > previousBet) {
          const increment = target - previousBet;
          this.currentBet = target;
          raised = true;
          fullRaise = previousBet === 0 ? increment >= this.bigBlind : increment >= this.minRaise;
          if (fullRaise) this.minRaise = increment;
        }
        break;
      }
    }

    this.actions.push({
      sequence: this.actions.length + 1,
      playerId: player.id,
      playerName: player.name,
      street: this.phase,
      type: action.type,
      amount: loggedAmount,
      at: this.now(),
    });
    this.version += 1;
    this.pendingSeats.delete(player.seat);

    if (raised && fullRaise) {
      this.actedSinceFullRaise.clear();
      this.actedSinceFullRaise.add(player.seat);
      this.pendingSeats.clear();
      for (const other of this.actionablePlayers()) {
        if (other.id !== player.id) this.pendingSeats.add(other.seat);
      }
    } else {
      this.actedSinceFullRaise.add(player.seat);
      if (raised) {
        for (const other of this.actionablePlayers()) {
          if (other.id !== player.id && other.committedStreet < this.currentBet) this.pendingSeats.add(other.seat);
        }
      }
    }

    this.afterAction(player.seat);
  }

  private postBlind(seat: number, amount: number, type: 'small_blind' | 'big_blind'): void {
    const player = this.playerAt(seat);
    const paid = this.commit(player, Math.min(amount, player.stack));
    this.actions.push({
      sequence: this.actions.length + 1,
      playerId: player.id,
      playerName: player.name,
      street: 'preflop',
      type,
      amount: paid,
      at: this.now(),
    });
  }

  private dealHoleCards(): void {
    let seat = this.dealerSeat;
    for (let round = 0; round < 2; round += 1) {
      for (let dealt = 0; dealt < this.players.length; dealt += 1) {
        seat = this.nextSeat(seat, () => true);
        const card = this.deck.shift();
        if (!card) throw new Error('牌堆不足');
        this.playerAt(seat).holeCards.push(card);
      }
    }
  }

  private commit(player: EnginePlayer, requested: number): number {
    const amount = Math.max(0, Math.min(requested, player.stack));
    player.stack -= amount;
    player.committedStreet += amount;
    player.committedHand += amount;
    player.allIn = player.stack === 0;
    return amount;
  }

  private afterAction(fromSeat: number): void {
    const contenders = this.players.filter((player) => !player.folded);
    if (contenders.length === 1) {
      const winner = contenders[0];
      if (!winner) throw new Error('无法确定赢家');
      this.awardUncontested(winner);
      return;
    }

    for (const seat of [...this.pendingSeats]) {
      const player = this.players.find((candidate) => candidate.seat === seat);
      if (!player || player.folded || player.allIn) this.pendingSeats.delete(seat);
    }
    for (const player of this.actionablePlayers()) {
      if (player.committedStreet < this.currentBet) this.pendingSeats.add(player.seat);
    }

    if (this.pendingSeats.size === 0) {
      this.advanceStreet();
      return;
    }
    this.actingSeat = this.findNextPending(fromSeat);
    this.resolveAutomaticProgress();
  }

  private resolveAutomaticProgress(): void {
    if (this.isComplete) return;
    const contenders = this.players.filter((player) => !player.folded);
    if (contenders.length <= 1) {
      const winner = contenders[0];
      if (winner) this.awardUncontested(winner);
      return;
    }
    const actionable = this.actionablePlayers();
    if (actionable.length === 1) {
      const player = actionable[0]!;
      if (player.committedStreet >= this.currentBet) {
        this.pendingSeats.clear();
        this.advanceStreet();
        return;
      }
    }
    if (actionable.length <= 1 && this.pendingSeats.size === 0) this.advanceStreet();
  }

  private advanceStreet(): void {
    this.pendingSeats.clear();
    this.actedSinceFullRaise.clear();
    for (const player of this.players) player.committedStreet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    if (this.phase === 'river') {
      this.resolveShowdown();
      return;
    }
    if (this.phase === 'preflop') {
      this.burn();
      this.drawBoard(3);
      this.phase = 'flop';
    } else if (this.phase === 'flop') {
      this.burn();
      this.drawBoard(1);
      this.phase = 'turn';
    } else if (this.phase === 'turn') {
      this.burn();
      this.drawBoard(1);
      this.phase = 'river';
    }
    this.version += 1;

    const actionable = this.actionablePlayers();
    if (actionable.length <= 1) {
      this.advanceStreet();
      return;
    }
    for (const player of actionable) this.pendingSeats.add(player.seat);
    this.actingSeat = this.findNextPending(this.dealerSeat);
  }

  private burn(): void {
    if (!this.deck.shift()) throw new Error('牌堆不足');
  }

  private drawBoard(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const card = this.deck.shift();
      if (!card) throw new Error('牌堆不足');
      this.board.push(card);
    }
  }

  private awardUncontested(winner: EnginePlayer): void {
    const amount = this.pot;
    winner.stack += amount;
    this.actions.push({
      sequence: this.actions.length + 1,
      playerId: winner.id,
      playerName: winner.name,
      street: 'complete',
      type: 'win',
      amount,
      at: this.now(),
    });
    this.phase = 'complete';
    this.actingSeat = null;
    this.result = {
      payouts: [{ playerId: winner.id, amount, reason: '其余玩家弃牌', handName: null }],
      evaluations: {},
      resultText: `${winner.name} 赢得 ${amount} 筹码`,
    };
    this.version += 1;
  }

  private resolveShowdown(): void {
    this.phase = 'showdown';
    this.actingSeat = null;
    const live = this.players.filter((player) => !player.folded);
    const evaluations: Record<string, HandEvaluation> = {};
    for (const player of live) evaluations[player.id] = evaluateBest([...player.holeCards, ...this.board]);

    const payouts = new Map<string, Payout>();
    const levels = [...new Set(this.players.map((player) => player.committedHand).filter((amount) => amount > 0))].sort(
      (a, b) => a - b,
    );
    let previous = 0;
    for (const level of levels) {
      const contributors = this.players.filter((player) => player.committedHand >= level);
      const amount = (level - previous) * contributors.length;
      previous = level;
      if (amount <= 0) continue;
      const eligible = contributors.filter((player) => !player.folded);
      if (eligible.length === 0) {
        const owner = contributors[0];
        if (owner) this.addPayout(payouts, owner, amount, '未被跟注筹码退回', null);
        continue;
      }
      let winners = [eligible[0]!];
      for (const candidate of eligible.slice(1)) {
        const comparison = compareEvaluations(evaluations[candidate.id]!, evaluations[winners[0]!.id]!);
        if (comparison > 0) winners = [candidate];
        else if (comparison === 0) winners.push(candidate);
      }
      const share = Math.floor(amount / winners.length);
      let remainder = amount % winners.length;
      const ordered = this.orderLeftOfDealer(winners);
      for (const winner of ordered) {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        this.addPayout(payouts, winner, share + extra, '摊牌', evaluations[winner.id]?.name ?? null);
      }
    }

    for (const payout of payouts.values()) {
      const player = this.getPlayer(payout.playerId);
      if (player) player.stack += payout.amount;
      this.actions.push({
        sequence: this.actions.length + 1,
        playerId: payout.playerId,
        playerName: player?.name ?? payout.playerId,
        street: 'showdown',
        type: 'win',
        amount: payout.amount,
        at: this.now(),
      });
    }
    const payoutList = [...payouts.values()];
    const resultText = payoutList
      .map((payout) => `${this.getPlayer(payout.playerId)?.name ?? payout.playerId} ${payout.handName ?? payout.reason} +${payout.amount}`)
      .join('，');
    this.result = { payouts: payoutList, evaluations, resultText };
    this.version += 1;
  }

  private addPayout(
    payouts: Map<string, Payout>,
    player: EnginePlayer,
    amount: number,
    reason: string,
    handName: string | null,
  ): void {
    const existing = payouts.get(player.id);
    if (existing) existing.amount += amount;
    else payouts.set(player.id, { playerId: player.id, amount, reason, handName });
  }

  private actionablePlayers(): EnginePlayer[] {
    return this.players.filter((player) => !player.folded && !player.allIn);
  }

  private playerAt(seat: number): EnginePlayer {
    const player = this.players.find((candidate) => candidate.seat === seat);
    if (!player) throw new Error(`座位 ${seat} 没有玩家`);
    return player;
  }

  private nextSeat(start: number, predicate: (player: EnginePlayer) => boolean): number {
    for (let offset = 1; offset <= 9; offset += 1) {
      const seat = (start + offset) % 9;
      const player = this.players.find((candidate) => candidate.seat === seat);
      if (player && predicate(player)) return seat;
    }
    throw new Error('找不到下一个座位');
  }

  private findNextPending(start: number): number | null {
    if (this.pendingSeats.size === 0) return null;
    return this.nextSeat(start, (player) => this.pendingSeats.has(player.seat));
  }

  private orderLeftOfDealer(players: EnginePlayer[]): EnginePlayer[] {
    return [...players].sort((left, right) => {
      const leftDistance = (left.seat - this.dealerSeat + 9) % 9 || 9;
      const rightDistance = (right.seat - this.dealerSeat + 9) % 9 || 9;
      return leftDistance - rightDistance;
    });
  }

  debugState(): string {
    return JSON.stringify({
      handId: this.handId,
      phase: this.phase,
      board: this.board.map(cardCode),
      pot: this.pot,
      currentBet: this.currentBet,
      actingSeat: this.actingSeat,
      players: this.players.map((player) => ({
        ...player,
        holeCards: player.holeCards.map(cardCode),
      })),
    });
  }
}
