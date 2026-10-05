import type { CardView, HandHistoryDetail } from '@poker/contracts';

export const ACTION_NAMES: Record<string, string> = {
  small_blind: '小盲',
  big_blind: '大盲',
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注',
  all_in: '全押',
  deal: '发牌',
  win: '赢得',
};

export const STREET_NAMES: Record<string, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  complete: '结算',
};

export interface ReplayPlayer {
  id: string;
  name: string;
  seat: number;
  holeCards: CardView[];
  stack: number;
  /** 本街已下注 */
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** 最近一次行动的文字，例如“加注 120” */
  lastAction: string | null;
  /** 本手赢得的筹码（结算后才有） */
  won: number;
}

export interface ReplayStep {
  /** 对应 actions 中的序号；第 0 步（发牌）为 null */
  sequence: number | null;
  street: string;
  board: CardView[];
  pot: number;
  players: ReplayPlayer[];
  actorId: string | null;
  description: string;
}

const BOARD_COUNT: Record<string, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

function visibleBoard(board: CardView[], street: string): CardView[] {
  return board.slice(0, BOARD_COUNT[street] ?? board.length);
}

export function describeAction(action: { playerName: string; action: string; amount: number }): string {
  return `${action.playerName} ${ACTION_NAMES[action.action] ?? action.action}${action.amount > 0 ? ` ${action.amount.toLocaleString('zh-CN')}` : ''}`;
}

/**
 * 根据牌谱逐条重建牌桌状态。第 0 步是发牌前的起始筹码，之后每个玩家动作（含盲注与派奖）对应一步；
 * 荷官的“发牌”记录不单独成步。每一步都满足：所有玩家筹码 + 底池 = 起始总筹码。
 */
export function buildReplaySteps(hand: HandHistoryDetail): ReplayStep[] {
  const players: ReplayPlayer[] = [...hand.players]
    .sort((left, right) => left.seat - right.seat)
    .map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      holeCards: player.holeCards,
      stack: player.startingStack,
      committed: 0,
      folded: false,
      allIn: false,
      lastAction: null,
      won: 0,
    }));
  const byId = new Map(players.map((player) => [player.id, player]));
  let pot = 0;
  let street = 'preflop';
  const snapshot = (sequence: number | null, actorId: string | null, description: string): ReplayStep => ({
    sequence,
    street,
    board: visibleBoard(hand.board, street),
    pot,
    players: players.map((player) => ({ ...player })),
    actorId,
    description,
  });
  const steps: ReplayStep[] = [snapshot(null, null, `第 ${hand.handNumber} 手开始，${players.length} 名玩家`)];

  for (const action of [...hand.actions].sort((left, right) => left.sequence - right.sequence)) {
    if (action.action === 'deal') continue;
    const player = byId.get(action.playerId);
    if (!player) continue;
    if (action.street !== street) {
      street = action.street;
      // 进入新的一条街：上一街的下注已经收进底池，最近行动也随之清空。
      for (const candidate of players) {
        candidate.committed = 0;
        if (!candidate.folded) candidate.lastAction = null;
      }
    }
    const text = `${ACTION_NAMES[action.action] ?? action.action}${action.amount > 0 ? ` ${action.amount.toLocaleString('zh-CN')}` : ''}`;
    if (action.action === 'win') {
      const amount = Math.min(action.amount, pot);
      pot -= amount;
      player.stack += amount;
      player.won += amount;
      for (const candidate of players) candidate.committed = 0;
    } else {
      const amount = Math.min(action.amount, player.stack);
      player.stack -= amount;
      player.committed += amount;
      pot += amount;
      if (action.action === 'fold') player.folded = true;
      if (player.stack === 0 && amount > 0) player.allIn = true;
    }
    player.lastAction = text;
    steps.push(snapshot(action.sequence, player.id, describeAction(action)));
  }
  return steps;
}
