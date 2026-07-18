import { describe, expect, it } from 'vitest';
import { compareEvaluations, evaluateBest, evaluateFive, parseCard } from '../src/index.js';

const cards = (value: string) => value.split(' ').map(parseCard);

describe('牌型判断', () => {
  it('正确识别皇家同花顺并击败四条', () => {
    const straightFlush = evaluateFive(cards('As Ks Qs Js Ts'));
    const quads = evaluateFive(cards('Ah Ad Ac As Kd'));
    expect(straightFlush.name).toBe('同花顺');
    expect(quads.name).toBe('四条');
    expect(compareEvaluations(straightFlush, quads)).toBeGreaterThan(0);
  });

  it('把 A2345 识别为五高顺子', () => {
    const wheel = evaluateFive(cards('As 2d 3h 4c 5s'));
    const sixHigh = evaluateFive(cards('2s 3d 4h 5c 6s'));
    expect(wheel.name).toBe('顺子');
    expect(wheel.tiebreakers).toEqual([5]);
    expect(compareEvaluations(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it('从七张牌中选择正确的葫芦', () => {
    const result = evaluateBest(cards('Ah Ad Ac Ks Kd 2c 3s'));
    expect(result.name).toBe('葫芦');
    expect(result.tiebreakers).toEqual([14, 13]);
  });
});
