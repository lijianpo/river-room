import type { PlayerStatsView } from '@poker/contracts';
import { decimal, percent, signedBb } from '../lib/stats-format';

/** 技术统计指标卡片；compact 用于牌桌上的对手资料卡。 */
export function StatTiles({ stats, compact = false }: { stats: PlayerStatsView; compact?: boolean }) {
  const tiles: Array<{ label: string; value: string; hint: string; tone?: 'positive' | 'negative' }> = [
    { label: '手数', value: stats.hands.toLocaleString('zh-CN'), hint: '统计范围内完成的手牌' },
    { label: 'VPIP', value: percent(stats.vpip), hint: '翻牌前主动入池率' },
    { label: 'PFR', value: percent(stats.pfr), hint: '翻牌前加注率' },
    { label: 'AF', value: decimal(stats.aggressionFactor), hint: '翻牌后（下注+加注）÷ 跟注' },
    { label: 'WTSD', value: percent(stats.wtsd), hint: '看到翻牌后进入摊牌的比例' },
    { label: 'W$SD', value: percent(stats.wsd), hint: '摊牌获胜率' },
  ];
  if (!compact) {
    tiles.push(
      { label: '胜率', value: percent(stats.winRate), hint: '净赢筹码的手数占比' },
      { label: '累计净赢', value: signedBb(stats.netBb), hint: `${stats.netChips >= 0 ? '+' : ''}${stats.netChips.toLocaleString('zh-CN')} 筹码`, tone: stats.netBb >= 0 ? 'positive' : 'negative' },
      { label: 'BB/100', value: stats.bbPer100 === null ? '—' : stats.bbPer100.toFixed(1), hint: '常规桌每百手净赢大盲', ...(stats.bbPer100 === null ? {} : { tone: stats.bbPer100 >= 0 ? 'positive' as const : 'negative' as const }) },
      { label: '最大赢池', value: stats.biggestPotWon.toLocaleString('zh-CN'), hint: '赢下的最大底池' },
    );
  }
  return (
    <dl className={`stat-tiles ${compact ? 'compact' : ''}`}>
      {tiles.map((tile) => (
        <div key={tile.label} title={tile.hint}>
          <dt>{tile.label}</dt>
          <dd className={tile.tone ?? ''}>{tile.value}</dd>
          {!compact && <small>{tile.hint}</small>}
        </div>
      ))}
    </dl>
  );
}
