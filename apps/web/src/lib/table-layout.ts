/** 各座位数下的座位坐标（百分比），第 0 个位置固定在桌子正下方。 */
export const SEAT_LAYOUTS: Record<number, Array<[number, number]>> = {
  2: [[50, 88], [50, 8]],
  3: [[50, 88], [12, 25], [88, 25]],
  4: [[50, 88], [8, 45], [50, 8], [92, 45]],
  5: [[50, 88], [8, 58], [26, 8], [74, 8], [92, 58]],
  6: [[50, 88], [12, 70], [14, 14], [50, 7], [86, 14], [88, 70]],
  7: [[50, 88], [15, 76], [6, 42], [28, 8], [72, 8], [94, 42], [85, 76]],
  8: [[50, 88], [20, 80], [6, 54], [15, 16], [50, 7], [85, 16], [94, 54], [80, 80]],
  9: [[50, 88], [20, 80], [6, 58], [9, 25], [30, 8], [70, 8], [91, 25], [94, 58], [80, 80]],
};

/** 座位号对应的坐标；传入 anchorSeat 时整桌旋转，让该座位位于正下方。 */
export function seatPosition(seatNumber: number, maxSeats: number, anchorSeat: number | null): [number, number] {
  const positions = SEAT_LAYOUTS[maxSeats] ?? SEAT_LAYOUTS[9]!;
  const index = anchorSeat === null ? seatNumber : (seatNumber - anchorSeat + maxSeats) % maxSeats;
  return positions[index] ?? positions[0]!;
}

export type BetPlacement = 'below' | 'left' | 'right';

/** 下注筹码摆放：上半桌放在座位下方，下半桌放在朝向桌心的一侧，避免压住公共牌。 */
export function betPlacement([x, y]: [number, number]): BetPlacement {
  if (y < 65) return 'below';
  return x <= 50 ? 'right' : 'left';
}
