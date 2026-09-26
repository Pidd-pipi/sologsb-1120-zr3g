/** 托盘状态：开盘中可放件/转格，关盘后只读 */
export type TrayStatus = 'open' | 'closed';

/** 托盘流水事件类型 */
export type TrayEventType = 'open' | 'put' | 'move' | 'return' | 'replace' | 'close';

export const TRAY_EVENT_TYPES: TrayEventType[] = ['open', 'put', 'move', 'return', 'replace', 'close'];

export const TRAY_EVENT_LABELS: Record<TrayEventType, string> = {
  open: '开盘',
  put: '放入',
  move: '转格',
  return: '归还',
  replace: '换新',
  close: '关盘',
};

export type TrayEventTone = 'primary' | 'success' | 'info' | 'warning' | 'danger';

export const TRAY_EVENT_TONES: Record<TrayEventType, TrayEventTone> = {
  open: 'info',
  put: 'primary',
  move: 'warning',
  return: 'success',
  replace: 'danger',
  close: 'info',
};

/** 托盘：一张分格收纳盘，rows×cols 个格位 */
export interface Tray {
  id: string;
  /** 托盘名称/编号，如 T-01 */
  name: string;
  rows: number;
  cols: number;
  status: TrayStatus;
  openedAt: number;
  openedBy: string;
  closedAt?: number;
  closedBy?: string;
}

export type TrayDraft = Pick<Tray, 'name' | 'rows' | 'cols'>;

/**
 * 格位占用记录（当前在盘零件）。
 * 复合主键 [trayId+slotCode] 保证同一格位只能有一件；
 * partId 唯一索引保证同一零件不能同时占两处。
 */
export interface SlotPlacement {
  trayId: string;
  /** 格位码，如 A1、C3 */
  slotCode: string;
  clockId: string;
  partId: string;
  putAt: number;
  putBy: string;
}

/** 托盘流水：只追加、不改写，任何经手都能追溯到人 */
export interface TrayEvent {
  id: string;
  /** 事件归属托盘；转格记目标托盘 */
  trayId: string;
  type: TrayEventType;
  /** 开盘/关盘事件无对应钟表与零件，存空串 */
  clockId: string;
  partId: string;
  at: number;
  operator: string;
  note?: string;
  /** 放入/归还/换新时所在格位 */
  slotCode?: string;
  /** 转格：来源托盘与格位 */
  fromTrayId?: string;
  fromSlotCode?: string;
  /** 转格：目标托盘与格位 */
  toTrayId?: string;
  toSlotCode?: string;
  /** 换新后生成的新零件 id */
  newPartId?: string;
}

export interface PutPartPayload {
  trayId: string;
  clockId: string;
  partId: string;
  slotCode: string;
  operator: string;
  note?: string;
}

export interface MovePartPayload {
  partId: string;
  toTrayId: string;
  toSlotCode: string;
  operator: string;
  note?: string;
}

export interface PartOpPayload {
  partId: string;
  operator: string;
  note?: string;
}

/** 行号转字母：0 -> A，1 -> B …… */
export function rowLetter(rowZeroBased: number): string {
  return String.fromCharCode(65 + rowZeroBased);
}

/** 格位码：行字母 + 列号（从 1 起），如 B3 */
export function slotCode(rowZeroBased: number, colOneBased: number): string {
  return `${rowLetter(rowZeroBased)}${colOneBased}`;
}

/** 按行优先列出托盘全部格位码 */
export function slotCodesOf(tray: Pick<Tray, 'rows' | 'cols'>): string[] {
  const codes: string[] = [];
  for (let r = 0; r < tray.rows; r += 1) {
    for (let c = 1; c <= tray.cols; c += 1) {
      codes.push(slotCode(r, c));
    }
  }
  return codes;
}
