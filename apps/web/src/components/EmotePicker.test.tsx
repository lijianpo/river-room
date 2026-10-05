import type { GameSnapshot, PlayerSnapshot } from '@poker/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmotePicker } from './EmotePicker';
import { PokerTable } from './PokerTable';

const player = (overrides: Partial<PlayerSnapshot>): PlayerSnapshot => ({
  id: 'p1', userId: null, name: '阿河', seat: 0, stack: 2_000, committed: 0, folded: false, allIn: false,
  connected: true, isBot: false, aiDifficulty: null, isDealer: false, isSmallBlind: false, isBigBlind: false,
  isActing: false, holeCards: [], placement: null, avatarUrl: '/api/avatars/preset/spade', leavingAfterHand: false,
  buyInChips: null, sittingOut: false, timeBankMs: 30_000, usingTimeBank: false, ...overrides,
});

const snapshot = (players: PlayerSnapshot[]): GameSnapshot => ({
  room: {
    id: 'r1', code: 'ABC123', name: '测试桌', mode: 'cash', ranked: false, visibility: 'public', status: 'playing',
    seated: players.length, humans: players.length, maxSeats: 2, targetPlayers: 2, smallBlind: 10, bigBlind: 20,
    hasAi: false, spectators: 0, minBuyInBb: null, maxBuyInBb: null, hostId: 'p1', inviteCode: 'ABC123',
    config: { name: '测试桌', mode: 'cash', visibility: 'public', ranked: false, maxSeats: 2, targetPlayers: 2, smallBlind: 10, bigBlind: 20, startingStackBb: 100, minBuyInBb: 40, maxBuyInBb: 200, autoFillAi: false, aiDifficulty: 'normal' },
  },
  selfId: 'p1', handId: null, handNumber: 0, version: 0, phase: 'waiting', board: [], pot: 0, currentBet: 0,
  dealerSeat: null, smallBlindSeat: null, bigBlindSeat: null, actingSeat: null, actionDeadline: null, countdownDeadline: null,
  players, legalActions: null, events: [], tournamentLevel: null, tournamentElapsedMs: null, resultMessage: null,
  selfRole: 'player', spectatorCount: 0, openSeats: [], showdown: null, selfWallet: null,
});

describe('牌桌表情', () => {
  it('座位上显示最近一次表情气泡', () => {
    const html = renderToStaticMarkup(
      <PokerTable snapshot={snapshot([player({}), player({ id: 'p2', name: '小盲', seat: 1 })])} onManagePlayer={() => undefined} onTakeSeat={() => undefined} emotes={{ p2: { id: 'e1', playerId: 'p2', emote: 'fire', at: 0 } }} />,
    );
    expect(html).toContain('seat-emote');
    expect(html).toContain('🔥');
    expect(html).toContain('小盲：火热');
  });

  it('暂离玩家显示暂离徽标', () => {
    const html = renderToStaticMarkup(<PokerTable snapshot={snapshot([player({ sittingOut: true })])} onManagePlayer={() => undefined} onTakeSeat={() => undefined} />);
    expect(html).toContain('sitting-out');
    expect(html).toContain('暂离');
  });

  it('选择面板默认收起', () => {
    const html = renderToStaticMarkup(<EmotePicker onEmote={() => undefined} onPhrase={() => undefined} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('class="emote-panel"');
  });
});
