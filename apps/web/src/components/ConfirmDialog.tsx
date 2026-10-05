import { AlertTriangle } from 'lucide-react';
import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useDialog } from '../lib/use-dialog';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** 需要用户补充文字时（替代 window.prompt）提供输入框 */
  input?: { label: string; defaultValue?: string };
}

export function ConfirmDialog({ options, onResult }: { options: ConfirmOptions; onResult: (value: string | null) => void }) {
  const ref = useDialog<HTMLElement>(true, () => onResult(null));
  const [text, setText] = useState(options.input?.defaultValue ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (options.input && !text.trim()) return;
    onResult(options.input ? text.trim() : '');
  };
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onResult(null)}>
      <section ref={ref} tabIndex={-1} className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <header><div className="confirm-heading"><span className={`confirm-icon ${options.danger ? 'danger' : ''}`}><AlertTriangle /></span><h2 id="confirm-title">{options.title}</h2></div></header>
        <form onSubmit={submit}>
          <p id="confirm-message">{options.message}</p>
          {options.input && <label>{options.input.label}<input data-autofocus value={text} maxLength={200} onChange={(event) => setText(event.target.value)} required /></label>}
          <div className="dialog-actions">
            <button type="button" className="secondary-button" data-autofocus={options.input ? undefined : true} onClick={() => onResult(null)}>取消</button>
            <button className={options.danger ? 'danger-button' : 'primary-button'} disabled={Boolean(options.input) && !text.trim()}>{options.confirmLabel ?? '确定'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/**
 * 页面内的确认/输入弹窗，替代 window.confirm 与 window.prompt。
 * 需要把返回的 element 渲染到页面中；confirm 解析为是否确认，prompt 解析为输入内容（取消时为 null）。
 */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>, (options: ConfirmOptions & { input: NonNullable<ConfirmOptions['input']> }) => Promise<string | null>] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);
  const open = useCallback((next: ConfirmOptions) => new Promise<string | null>((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setOptions(next);
  }), []);
  const confirm = useCallback(async (next: ConfirmOptions) => (await open(next)) !== null, [open]);
  const finish = (value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };
  return [options ? <ConfirmDialog key={options.title + options.message} options={options} onResult={finish} /> : null, confirm, open];
}
