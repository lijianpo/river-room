import type { EmoteId } from '@poker/contracts';

/** 表情 id 到 emoji 与无障碍标签的映射；顺序即选择面板中的顺序。 */
export const EMOTES: Array<{ id: EmoteId; emoji: string; label: string }> = [
  { id: 'thumbs_up', emoji: '👍', label: '点赞' },
  { id: 'laugh', emoji: '😂', label: '大笑' },
  { id: 'wow', emoji: '😮', label: '惊讶' },
  { id: 'cry', emoji: '😭', label: '哭泣' },
  { id: 'angry', emoji: '😡', label: '生气' },
  { id: 'think', emoji: '🤔', label: '思考' },
  { id: 'fire', emoji: '🔥', label: '火热' },
  { id: 'gg', emoji: '🤝', label: 'GG' },
];

const byId = new Map(EMOTES.map((emote) => [emote.id, emote]));

export function emoteOf(id: EmoteId): { emoji: string; label: string } {
  return byId.get(id) ?? { emoji: '💬', label: id };
}

/** 快捷语直接作为聊天消息发送。 */
export const QUICK_PHRASES = ['好牌！', '快点吧～', '运气不错', '这把我不跟了', 'GG'];

/** 表情气泡在座位上停留的时长 */
export const EMOTE_DISPLAY_MS = 2_500;
