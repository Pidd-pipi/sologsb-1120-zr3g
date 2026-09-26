/** 托盘状态 */
export type TrayState = 'open' | 'closed';

/** 零件托盘（格位按行优先从 1 编号） */
export interface Tray {
  id: string;
  /** 托盘编号，唯一 */
  trayNo: string;
  /** 行数 */
  rows: number;
  /** 列数 */
  cols: number;
  /** 存放位置 */
  location: string;
  state: TrayState;
  note: string;
  createdAt: number;
  closedAt?: number;
}

export type TrayDraft = Omit<Tray, 'id' | 'state' | 'createdAt' | 'closedAt'>;

/** 格位占用（当前在盘的零件，归还/换新后删除，历史查流水） */
export interface TrayPlacement {
  id: string;
  trayId: string;
  /** 格位号，1..rows*cols */
  cellNo: number;
  clockId: string;
  partId: string;
  /** 末次经手人（放入或转格/换新的操作人） */
  operator: string;
  /** 末次入格时间 */
  placedAt: number;
}

/** 托盘操作类型 */
export type TrayAction = 'place' | 'move' | 'return' | 'replace' | 'close' | 'reopen';

export const TRAY_ACTIONS: TrayAction[] = ['place', 'move', 'return', 'replace', 'close', 'reopen'];

export const TRAY_ACTION_LABELS: Record<TrayAction, string> = {
  place: '放入',
  move: '转格',
  return: '归还',
  replace: '换新',
  close: '关盘',
  reopen: '重开',
};

/** 托盘操作流水（只增不删，丢失可追溯末次经手人） */
export interface TrayEvent {
  id: string;
  trayId: string;
  action: TrayAction;
  operator: string;
  at: number;
  note: string;
  /** 目标格位（关盘/重开时无） */
  cellNo?: number;
  clockId?: string;
  partId?: string;
  /** 转格来源 */
  fromTrayId?: string;
  fromCellNo?: number;
  /** 换新时被换下的旧零件 */
  replacedPartId?: string;
}

/** 托盘业务校验错误，message 面向操作者 */
export class TrayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrayError';
  }
}

/** 托盘总格数 */
export function totalCells(tray: Pick<Tray, 'rows' | 'cols'>): number {
  return tray.rows * tray.cols;
}

/** 格位号 → 行列标签，如 6 列盘中第 9 格 → B3 */
export function cellLabel(cellNo: number, cols: number): string {
  if (cols < 1 || cellNo < 1) return `#${cellNo}`;
  const idx = cellNo - 1;
  const row = Math.floor(idx / cols);
  const col = (idx % cols) + 1;
  return `${String.fromCharCode(65 + row)}${col}`;
}
