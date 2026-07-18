import { describe, expect, it } from 'vitest';
import { createActionId } from './action-id';

describe('createActionId', () => {
  it('在不支持 crypto.randomUUID 的非安全来源中仍生成合法且不同的操作 ID', () => {
    const first = createActionId(null);
    const second = createActionId(null);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(second).not.toBe(first);
  });

  it('在安全来源中优先使用浏览器 UUID', () => {
    expect(createActionId({ randomUUID: () => 'browser-generated-id' })).toBe('browser-generated-id');
  });
});
