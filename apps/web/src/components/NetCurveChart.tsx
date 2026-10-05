import { curveGeometry } from '../lib/stats-format';

const WIDTH = 600;
const HEIGHT = 160;

/** 累计净赢（BB）折线图，内联 SVG，不依赖图表库。 */
export function NetCurveChart({ values }: { values: number[] }) {
  const geometry = curveGeometry(values, WIDTH, HEIGHT);
  if (!geometry) return <p className="net-curve-empty">完成几手牌后，这里会显示净赢走势。</p>;
  const final = values[values.length - 1] ?? 0;
  const trend = final >= 0 ? 'up' : 'down';
  return (
    <figure className={`net-curve ${trend}`}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`最近 ${values.length - 1} 手累计净赢 ${final.toFixed(1)} BB，最高 ${geometry.max.toFixed(1)} BB，最低 ${geometry.min.toFixed(1)} BB`}>
        <line className="net-curve-zero" x1={0} x2={WIDTH} y1={geometry.zeroY} y2={geometry.zeroY} />
        <polyline className="net-curve-line" points={geometry.points} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption><span>最近 {values.length - 1} 手</span><span>最高 {geometry.max.toFixed(1)} · 最低 {geometry.min.toFixed(1)} BB</span></figcaption>
    </figure>
  );
}
