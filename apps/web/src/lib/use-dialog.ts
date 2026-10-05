import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 打开中的弹窗栈：只有最上层弹窗响应 Esc 与 Tab。
const stack: symbol[] = [];

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
}

/**
 * 为弹窗提供统一的键盘行为：打开时聚焦（优先 `data-autofocus`），Tab 焦点限制在弹窗内，
 * Esc 关闭（未传 onClose 时忽略），关闭后把焦点还给打开前的元素。
 */
export function useDialog<T extends HTMLElement = HTMLElement>(open: boolean, onClose?: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol('dialog');
    stack.push(id);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = ref.current;
    if (container) {
      const initial = container.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(container)[0] ?? container;
      initial.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !ref.current) return;
      if (event.key === 'Escape') {
        if (!closeRef.current) return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables(ref.current);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !ref.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !ref.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      stack.splice(stack.indexOf(id), 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  return ref;
}
