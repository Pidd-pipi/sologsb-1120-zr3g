/** 统一的本地日期时间格式 */
export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 钟表调色板：同一钟表在格位图中颜色稳定一致 */
const CLOCK_PALETTE = [
  '#2f6fb0',
  '#8a5cb8',
  '#b0712f',
  '#2f9e6e',
  '#b8486b',
  '#4a7c59',
  '#7a6a3d',
  '#55678a',
];

export function clockColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CLOCK_PALETTE[hash % CLOCK_PALETTE.length];
}
