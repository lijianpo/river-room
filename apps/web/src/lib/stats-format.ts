/** 比率显示为整数百分比，没有样本时显示破折号。 */
export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function decimal(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

export function signedBb(value: number | null): string {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} BB`;
}

/** 样本少于该手数时提示数据仅供参考 */
export const SMALL_SAMPLE_HANDS = 20;

export interface CurveGeometry {
  points: string;
  zeroY: number;
  min: number;
  max: number;
}

/** 把累计净赢序列映射到 width×height 的 SVG 坐标，纵轴始终包含 0。 */
export function curveGeometry(values: number[], width: number, height: number, padding = 6): CurveGeometry | null {
  if (values.length === 0) return null;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const innerHeight = height - padding * 2;
  const y = (value: number) => padding + ((max - value) / span) * innerHeight;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((value, index) => `${(values.length > 1 ? index * step : width / 2).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  return { points, zeroY: y(0), min, max };
}
