import { Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LatencyBadge({ connected = true }: { connected?: boolean }) {
  const { latencyMs, latencyTimedOut } = useAuth();
  const level = latencyMs === null ? 'unknown' : latencyMs < 100 ? 'good' : latencyMs < 250 ? 'fair' : 'poor';
  return (
    <span className={`latency-badge ${level}`} title="每 5 秒测量一次网络往返延迟">
      {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
      {!connected ? '-- ms' : latencyTimedOut ? '超时' : latencyMs === null ? '测量中' : `${latencyMs} ms`}
    </span>
  );
}
