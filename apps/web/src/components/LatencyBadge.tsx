import { Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/** 网络延迟徽章；未传 connected 时使用全局实时连接状态。 */
export function LatencyBadge({ connected: connectedProp }: { connected?: boolean }) {
  const { latencyMs, latencyTimedOut, socketConnected } = useAuth();
  const connected = connectedProp ?? socketConnected;
  const level = !connected ? 'poor' : latencyMs === null ? 'unknown' : latencyMs < 100 ? 'good' : latencyMs < 250 ? 'fair' : 'poor';
  return (
    <span className={`latency-badge ${level}`} title={connected ? '每 5 秒测量一次网络往返延迟' : '实时连接已断开，正在重连'}>
      {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
      {!connected ? '离线' : latencyTimedOut ? '超时' : latencyMs === null ? '测量中' : `${latencyMs} ms`}
    </span>
  );
}
