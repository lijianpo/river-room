import type { PlayerStatsView } from '@poker/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NetCurveChart } from './NetCurveChart';
import { StatTiles } from './StatTiles';

const stats: PlayerStatsView = {
  hands: 12, vpip: 0.25, pfr: 0.125, aggressionFactor: 2, wtsd: null, wsd: null, winRate: 0.5,
  netChips: -300, netBb: -15, bbPer100: -125, biggestPotWon: 800, netCurve: [0, 2, -15],
};

describe('数据面板', () => {
  it('没有数据时显示提示，不渲染 SVG', () => {
    const html = renderToStaticMarkup(<NetCurveChart values={[]} />);
    expect(html).toContain('net-curve-empty');
    expect(html).not.toContain('<svg');
  });

  it('只有起点时也能渲染，下行走势使用 down 样式', () => {
    expect(renderToStaticMarkup(<NetCurveChart values={[0]} />)).toContain('<polyline');
    const html = renderToStaticMarkup(<NetCurveChart values={stats.netCurve} />);
    expect(html).toContain('net-curve down');
    expect(html).toContain('累计净赢 -15.0 BB');
  });

  it('指标卡片：无样本显示破折号，资料卡只展示核心指标', () => {
    const full = renderToStaticMarkup(<StatTiles stats={stats} />);
    expect(full).toContain('25%');
    expect(full).toContain('—');
    expect(full).toContain('-15.0 BB');
    const compact = renderToStaticMarkup(<StatTiles stats={stats} compact />);
    expect(compact).not.toContain('BB/100');
    expect(compact).toContain('VPIP');
  });
});
