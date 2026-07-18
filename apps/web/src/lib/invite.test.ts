import { describe, expect, it } from 'vitest';
import {
  buildInviteUrl,
  isLoopbackInviteOrigin,
  isSafeInviteReturnTo,
  isValidInviteCode,
  normalizeInviteCode,
  resolvePublicAppOrigin,
} from './invite';

describe('房间邀请链接', () => {
  it('规范化邀请码并生成同源邀请地址', () => {
    expect(normalizeInviteCode(' abcd23 ')).toBe('ABCD23');
    expect(isValidInviteCode('abcd23')).toBe(true);
    expect(buildInviteUrl('abcd23', 'https://poker.example.com/')).toBe('https://poker.example.com/invite/ABCD23');
  });

  it('优先使用配置的公网地址，无效配置回退当前来源', () => {
    expect(resolvePublicAppOrigin('https://play.example.com/path', 'http://192.168.1.8:5174')).toBe('https://play.example.com');
    expect(resolvePublicAppOrigin('not-a-url', 'http://192.168.1.8:5174')).toBe('http://192.168.1.8:5174');
  });

  it('识别本机来源和安全的邀请回跳路径', () => {
    expect(isLoopbackInviteOrigin('http://localhost:5174')).toBe(true);
    expect(isLoopbackInviteOrigin('http://127.0.0.2:5174')).toBe(true);
    expect(isLoopbackInviteOrigin('http://[::1]:5174')).toBe(true);
    expect(isLoopbackInviteOrigin('https://poker.example.com')).toBe(false);
    expect(isSafeInviteReturnTo('/invite/ABCD23')).toBe(true);
    expect(isSafeInviteReturnTo('//evil.example/invite/ABCD23')).toBe(false);
  });
});
