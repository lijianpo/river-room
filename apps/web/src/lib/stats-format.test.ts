import { describe, expect, it } from 'vitest';
import { curveGeometry, decimal, percent, signedBb } from './stats-format';

describe('统计数据格式化', () => {
  it('比率与 BB 的显示', () => {
    expect(percent(0.234)).toBe('23%');
    expect(percent(null)).toBe('—');
    expect(decimal(1.25)).toBe('1.3');
    expect(signedBb(12.5)).toBe('+12.5 BB');
    expect(signedBb(-3)).toBe('-3.0 BB');
  });

  it('曲线纵轴包含 0，单点居中，空数据返回 null', () => {
    expect(curveGeometry([], 100, 50)).toBeNull();
    expect(curveGeometry([5], 100, 50)!.points).toBe('50.0,6.0');
    const geometry = curveGeometry([0, 10, -10], 100, 50)!;
    expect(geometry).toMatchObject({ min: -10, max: 10, zeroY: 25 });
    expect(geometry.points).toBe('0.0,25.0 50.0,6.0 100.0,44.0');
  });
});
