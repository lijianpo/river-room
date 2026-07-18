import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

function fallbackDocument(copied: boolean) {
  const textarea = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  };
  const documentMock = {
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => textarea),
    execCommand: vi.fn(() => copied),
  };
  return { documentMock, textarea };
}

afterEach(() => vi.unstubAllGlobals());

describe('兼容剪贴板复制', () => {
  it('优先使用 Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const createElement = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', { createElement });

    await copyText('temporary-password');

    expect(writeText).toHaveBeenCalledWith('temporary-password');
    expect(createElement).not.toHaveBeenCalled();
  });

  it('Clipboard API 被拒绝后使用隐藏文本框复制', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const { documentMock, textarea } = fallbackDocument(true);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', documentMock);

    await copyText('fallback-value');

    expect(textarea.value).toBe('fallback-value');
    expect(textarea.select).toHaveBeenCalled();
    expect(textarea.setSelectionRange).toHaveBeenCalledWith(0, 14);
    expect(documentMock.execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalled();
  });

  it('所有复制方式均失败时清理文本框并返回可读错误', async () => {
    const { documentMock, textarea } = fallbackDocument(false);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', documentMock);

    await expect(copyText('cannot-copy')).rejects.toThrow('浏览器未允许复制，请长按内容手动复制');
    expect(textarea.remove).toHaveBeenCalled();
  });
});
