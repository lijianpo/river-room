import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** 渲染出错时显示错误信息与恢复入口，避免整页卸载后只剩黑屏。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('页面渲染出错', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="room-loading" role="alert">
        <span className="chip-loader">♠</span>
        <h2>页面出错了</h2>
        <p className="error-boundary-message">{error.message || String(error)}</p>
        <div className="invite-state-actions">
          <button className="secondary-button" onClick={() => window.location.assign('/lobby')}>返回大厅</button>
          <button className="primary-button" onClick={() => window.location.reload()}>刷新页面</button>
        </div>
      </div>
    );
  }
}
