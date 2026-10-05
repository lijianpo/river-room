import type { LegalActions, PlayerActionType } from '@poker/contracts';

export type PreAction = 'check_fold' | 'check' | 'call_any';

/** 轮到自己时，把预选操作换算成实际动作；返回 null 表示预选已失效，需要玩家手动操作。 */
export function resolvePreAction(preAction: PreAction, legal: LegalActions): PlayerActionType | null {
  switch (preAction) {
    case 'check_fold':
      return legal.canCheck ? 'check' : 'fold';
    case 'check':
      return legal.canCheck ? 'check' : null;
    case 'call_any':
      return legal.callAmount > 0 ? 'call' : legal.canCheck ? 'check' : null;
  }
}

export interface BetPreset {
  label: string;
  value: number;
}

/** 下注快捷金额：翻牌前未加注时提供 2.5BB/3BB，其余按底池比例，最后是全押；金额已按合法范围截断并去重。 */
export function betPresets({
  legal,
  pot,
  currentBet,
  bigBlind,
  boardCount,
}: {
  legal: LegalActions;
  pot: number;
  currentBet: number;
  bigBlind: number;
  boardCount: number;
}): BetPreset[] {
  const minimum = legal.minBet ?? legal.minRaiseTo ?? 0;
  if (minimum <= 0 || legal.maxAmount < minimum) return [];
  const isBet = legal.minBet !== null;
  const candidates: BetPreset[] = [];
  if (boardCount === 0 && currentBet <= bigBlind) {
    candidates.push({ label: '2.5BB', value: Math.round(bigBlind * 2.5) }, { label: '3BB', value: bigBlind * 3 });
  }
  for (const ratio of [0.5, 0.75, 1]) {
    const value = isBet ? Math.round(pot * ratio) : currentBet + Math.round((pot + legal.callAmount) * ratio);
    candidates.push({ label: ratio === 1 ? '满池' : `${ratio * 100}%`, value });
  }
  candidates.push({ label: '全押', value: legal.maxAmount });
  const seen = new Set<number>();
  return candidates
    .map((preset) => ({ ...preset, value: Math.min(legal.maxAmount, Math.max(minimum, preset.value)) }))
    .filter((preset) => !seen.has(preset.value) && seen.add(preset.value));
}

/** 把手动输入的下注额限制在合法范围内。 */
export function clampBet(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
