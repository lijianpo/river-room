import { useEffect, useRef, useState } from 'react';

export interface TurnClock {
  /** 剩余毫秒 */
  remaining: number;
  /** 剩余比例 0–1；以首次看到该截止时间时的剩余时长为总长 */
  progress: number;
}

/** 行动倒计时。服务端只下发截止时间，因此用首次观察到的剩余时长作为进度条总长。 */
export function useTurnClock(deadline: number | null): TurnClock {
  const total = useRef<{ deadline: number | null; ms: number }>({ deadline: null, ms: 0 });
  const [remaining, setRemaining] = useState(0);
  if (total.current.deadline !== deadline) {
    total.current = { deadline, ms: deadline ? Math.max(1, deadline - Date.now()) : 0 };
  }
  useEffect(() => {
    const update = () => setRemaining(deadline ? Math.max(0, deadline - Date.now()) : 0);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return { remaining, progress: total.current.ms ? Math.min(1, remaining / total.current.ms) : 0 };
}
