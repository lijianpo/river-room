export const PRESET_AVATARS = [
  { id: 'spade', label: '黑桃', symbol: '♠', color: '#176b4d' },
  { id: 'heart', label: '红桃', symbol: '♥', color: '#b9474b' },
  { id: 'diamond', label: '方片', symbol: '♦', color: '#c76b2a' },
  { id: 'club', label: '梅花', symbol: '♣', color: '#3c526f' },
  { id: 'crown', label: '皇冠', symbol: '♛', color: '#9b7726' },
  { id: 'star', label: '星星', symbol: '★', color: '#6c55a3' },
  { id: 'moon', label: '月亮', symbol: '☾', color: '#40577c' },
  { id: 'sun', label: '太阳', symbol: '☀', color: '#ae6d1f' },
  { id: 'fox', label: '狐狸', symbol: '狐', color: '#a65332' },
  { id: 'tiger', label: '老虎', symbol: '虎', color: '#9a5f22' },
  { id: 'dragon', label: '龙', symbol: '龙', color: '#8f3838' },
  { id: 'panda', label: '熊猫', symbol: '熊', color: '#444b50' },
] as const;

export type PresetAvatarId = (typeof PRESET_AVATARS)[number]['id'];

export function isPresetAvatar(value: string): value is PresetAvatarId {
  return PRESET_AVATARS.some((avatar) => avatar.id === value);
}

export function avatarUrl(type: string | null | undefined, value: string | null | undefined): string {
  if (type === 'upload' && value && /^[a-f0-9-]+\.webp$/i.test(value)) return `/media/avatars/${value}`;
  const preset = value && isPresetAvatar(value) ? value : 'spade';
  return `/api/avatars/preset/${preset}`;
}

export function presetAvatarSvg(id: string): string | null {
  const avatar = PRESET_AVATARS.find((item) => item.id === id);
  if (!avatar) return null;
  const symbol = avatar.symbol.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="64" fill="${avatar.color}"/><circle cx="128" cy="128" r="94" fill="rgba(255,255,255,.08)"/><text x="128" y="151" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="96" fill="#fff">${symbol}</text></svg>`;
}
