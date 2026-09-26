import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import {
  type MovePartPayload,
  type PartOpPayload,
  type PutPartPayload,
  type SlotPlacement,
  type Tray,
  type TrayDraft,
  type TrayEvent,
} from '../types/tray';
import type { MovementPart, MovementPartDraft } from '../types/part';
import { slotCodesOf } from '../types/tray';
import { usePartStore } from './partStore';

/** 关盘时仍有零件未处理，携带具体格位供页面点名 */
export class TrayNotEmptyError extends Error {
  slots: SlotPlacement[];
  constructor(slots: SlotPlacement[]) {
    super('托盘尚有未处理零件');
    this.name = 'TrayNotEmptyError';
    this.slots = slots;
  }
}

/** 格位冲突等业务错误（唯一约束的预检查失败） */
export class TrayConflictError extends Error {}

interface TrayState {
  trays: Tray[];
  placements: SlotPlacement[];
  events: TrayEvent[];
  loaded: boolean;
}

export const useTrayStore = defineStore('tray', {
  state: (): TrayState => ({ trays: [], placements: [], events: [], loaded: false }),
  getters: {
    openTrays: (state) =>
      state.trays.filter((t) => t.status === 'open').sort((a, b) => b.openedAt - a.openedAt),
    byId: (state) => (id: string) => state.trays.find((t) => t.id === id),
    trayName: (state) => (id: string) => state.trays.find((t) => t.id === id)?.name ?? '未知托盘',
    placementAt: (state) => (trayId: string, slotCode: string) =>
      state.placements.find((p) => p.trayId === trayId && p.slotCode === slotCode),
    /** 零件当前所在格位；返回 undefined 表示已归位/换新出盘 */
    placementOf: (state) => (partId: string) => state.placements.find((p) => p.partId === partId),
    placementsOfTray: (state) => (trayId: string) =>
      state.placements.filter((p) => p.trayId === trayId),
    /** 某台钟表此刻散落在哪些托盘格位 */
    placementsOfClock: (state) => (clockId: string) =>
      state.placements.filter((p) => p.clockId === clockId),
    eventsByTray: (state) => (trayId: string) =>
      state.events
        .filter((e) => e.trayId === trayId || e.fromTrayId === trayId || e.toTrayId === trayId)
        .sort((a, b) => b.at - a.at),
    eventsByClock: (state) => (clockId: string) =>
      state.events.filter((e) => e.clockId === clockId).sort((a, b) => b.at - a.at),
  },
  actions: {
    async load() {
      const [trays, placements, events] = await Promise.all([
        db.trays.toArray(),
        db.placements.toArray(),
        db.trayEvents.toArray(),
      ]);
      this.trays = trays.sort((a, b) => b.openedAt - a.openedAt);
      this.placements = placements;
      this.events = events.sort((a, b) => b.at - a.at);
      this.loaded = true;
    },

    /** 开盘：登记托盘并预生成格位，记录开盘人与时间 */
    async openTray(draft: TrayDraft, operator: string): Promise<Tray> {
      const name = draft.name.trim();
      if (!name) throw new TrayConflictError('请填写托盘名称');
      if (this.trays.some((t) => t.name === name)) {
        throw new TrayConflictError(`托盘「${name}」已存在，请更换名称`);
      }
      const rows = Math.max(1, Math.min(26, Math.floor(draft.rows)));
      const cols = Math.max(1, Math.min(50, Math.floor(draft.cols)));
      const at = Date.now();
      const record: Tray = {
        id: newId('tray'),
        name,
        rows,
        cols,
        status: 'open',
        openedAt: at,
        openedBy: operator,
      };
      const event: TrayEvent = {
        id: newId('tev'),
        trayId: record.id,
        type: 'open',
        clockId: '',
        partId: '',
        at,
        operator,
        note: `${rows} 行 × ${cols} 列，共 ${rows * cols} 格`,
      };
      await db.transaction('rw', db.trays, db.trayEvents, async () => {
        await db.trays.put(toPlain(record));
        await db.trayEvents.put(toPlain(event));
      });
      this.trays = [record, ...this.trays];
      this.events = [event, ...this.events];
      return record;
    },

    /** 关盘：尚有零件在格位则点名具体格位并拒绝关盘 */
    async closeTray(trayId: string, operator: string): Promise<void> {
      const tray = this.trays.find((t) => t.id === trayId);
      if (!tray) throw new TrayConflictError('托盘不存在');
      if (tray.status !== 'open') throw new TrayConflictError('托盘已关盘');
      const remaining = this.placements
        .filter((p) => p.trayId === trayId)
        .sort((a, b) => a.slotCode.localeCompare(b.slotCode));
      if (remaining.length > 0) throw new TrayNotEmptyError(remaining);

      const at = Date.now();
      const event: TrayEvent = {
        id: newId('tev'),
        trayId,
        type: 'close',
        clockId: '',
        partId: '',
        at,
        operator,
      };
      await db.transaction('rw', db.trays, db.trayEvents, async () => {
        await db.trays.update(trayId, { status: 'closed', closedAt: at, closedBy: operator });
        await db.trayEvents.put(toPlain(event));
      });
      this.trays = this.trays.map((t) =>
        t.id === trayId ? { ...t, status: 'closed', closedAt: at, closedBy: operator } : t,
      );
      this.events = [event, ...this.events];
    },

    /** 放入：同一格位、同一零件都不能已被占用，且托盘必须处于开盘状态 */
    async putPart(payload: PutPartPayload): Promise<void> {
      const operator = payload.operator.trim();
      if (!operator) throw new TrayConflictError('请选择操作人');
      if (!payload.clockId) throw new TrayConflictError('请选择钟表');
      if (!payload.partId) throw new TrayConflictError('请选择零件');
      const tray = this.trays.find((t) => t.id === payload.trayId);
      if (!tray) throw new TrayConflictError('托盘不存在');
      if (tray.status !== 'open') throw new TrayConflictError('托盘已关盘，不能再放入');
      if (!slotCodesOf(tray).includes(payload.slotCode)) {
        throw new TrayConflictError(`格位 ${payload.slotCode} 不属于托盘 ${tray.name}`);
      }
      if (this.placements.some((p) => p.trayId === payload.trayId && p.slotCode === payload.slotCode)) {
        throw new TrayConflictError(`格位 ${payload.slotCode} 已被占用`);
      }
      if (this.placements.some((p) => p.partId === payload.partId)) {
        throw new TrayConflictError('该零件已在托盘格位中，不能重复放入');
      }
      const at = Date.now();
      const placement: SlotPlacement = {
        trayId: payload.trayId,
        slotCode: payload.slotCode,
        clockId: payload.clockId,
        partId: payload.partId,
        putAt: at,
        putBy: operator,
      };
      const event: TrayEvent = {
        id: newId('tev'),
        trayId: payload.trayId,
        type: 'put',
        clockId: payload.clockId,
        partId: payload.partId,
        at,
        operator,
        note: payload.note?.trim() || undefined,
        slotCode: payload.slotCode,
      };
      await db.transaction('rw', db.placements, db.trayEvents, async () => {
        await db.placements.put(toPlain(placement));
        await db.trayEvents.put(toPlain(event));
      });
      this.placements = [...this.placements, placement];
      this.events = [event, ...this.events];
    },

    /** 转格：目标格位必须空闲；同盘转格或跨盘转格均可（跨盘目标盘须开盘） */
    async movePart(payload: MovePartPayload): Promise<void> {
      const operator = payload.operator.trim();
      if (!operator) throw new TrayConflictError('请选择操作人');
      const current = this.placements.find((p) => p.partId === payload.partId);
      if (!current) throw new TrayConflictError('该零件当前不在托盘格位中');
      if (current.trayId === payload.toTrayId && current.slotCode === payload.toSlotCode) {
        throw new TrayConflictError('目标格位与当前格位相同');
      }
      const targetTray = this.trays.find((t) => t.id === payload.toTrayId);
      if (!targetTray) throw new TrayConflictError('目标托盘不存在');
      if (targetTray.status !== 'open') throw new TrayConflictError('目标托盘已关盘');
      if (!slotCodesOf(targetTray).includes(payload.toSlotCode)) {
        throw new TrayConflictError(`格位 ${payload.toSlotCode} 不属于托盘 ${targetTray.name}`);
      }
      if (
        this.placements.some(
          (p) => p.trayId === payload.toTrayId && p.slotCode === payload.toSlotCode,
        )
      ) {
        throw new TrayConflictError(`格位 ${payload.toSlotCode} 已被占用`);
      }
      const at = Date.now();
      const moved: SlotPlacement = {
        trayId: payload.toTrayId,
        slotCode: payload.toSlotCode,
        clockId: current.clockId,
        partId: current.partId,
        putAt: at,
        putBy: operator,
      };
      const event: TrayEvent = {
        id: newId('tev'),
        trayId: payload.toTrayId,
        type: 'move',
        clockId: current.clockId,
        partId: current.partId,
        at,
        operator,
        note: payload.note?.trim() || undefined,
        fromTrayId: current.trayId,
        fromSlotCode: current.slotCode,
        toTrayId: payload.toTrayId,
        toSlotCode: payload.toSlotCode,
      };
      await db.transaction('rw', db.placements, db.trayEvents, async () => {
        await db.placements.delete([current.trayId, current.slotCode]);
        await db.placements.put(toPlain(moved));
        await db.trayEvents.put(toPlain(event));
      });
      this.placements = [...this.placements.filter((p) => p.partId !== payload.partId), moved];
      this.events = [event, ...this.events];
    },

    /** 归还：零件从格位取出装回机芯 */
    async returnPart(payload: PartOpPayload): Promise<void> {
      const operator = payload.operator.trim();
      if (!operator) throw new TrayConflictError('请选择操作人');
      const current = this.placements.find((p) => p.partId === payload.partId);
      if (!current) throw new TrayConflictError('该零件当前不在托盘格位中');
      const at = Date.now();
      const event: TrayEvent = {
        id: newId('tev'),
        trayId: current.trayId,
        type: 'return',
        clockId: current.clockId,
        partId: current.partId,
        at,
        operator,
        note: payload.note?.trim() || undefined,
        slotCode: current.slotCode,
      };
      await db.transaction('rw', db.placements, db.trayEvents, async () => {
        await db.placements.delete([current.trayId, current.slotCode]);
        await db.trayEvents.put(toPlain(event));
      });
      this.placements = this.placements.filter((p) => p.partId !== payload.partId);
      this.events = [event, ...this.events];
    },

    /**
     * 换新：旧件出盘登记、新件入零件台账并放入目标格位，一条流水同时留下
     * 末次经手人；新件与旧件记录都保留，不做删除。
     */
    async replacePart(
      payload: PartOpPayload,
      newPartDraft: MovementPartDraft,
      target: { trayId: string; slotCode: string },
    ): Promise<MovementPart> {
      const operator = payload.operator.trim();
      if (!operator) throw new TrayConflictError('请选择操作人');
      const old = this.placements.find((p) => p.partId === payload.partId);
      if (!old) throw new TrayConflictError('旧零件当前不在托盘格位中');
      const targetTray = this.trays.find((t) => t.id === target.trayId);
      if (!targetTray) throw new TrayConflictError('目标托盘不存在');
      if (targetTray.status !== 'open') throw new TrayConflictError('目标托盘已关盘');
      if (!slotCodesOf(targetTray).includes(target.slotCode)) {
        throw new TrayConflictError(`格位 ${target.slotCode} 不属于托盘 ${targetTray.name}`);
      }
      if (
        this.placements.some(
          (p) => p.trayId === target.trayId && p.slotCode === target.slotCode && p.partId !== old.partId,
        )
      ) {
        throw new TrayConflictError(`格位 ${target.slotCode} 已被占用`);
      }

      const partStore = usePartStore();
      const at = Date.now();
      const created: MovementPart = { ...toPlain(newPartDraft), id: newId('prt') };
      const newPlacement: SlotPlacement = {
        trayId: target.trayId,
        slotCode: target.slotCode,
        clockId: created.clockId,
        partId: created.id,
        putAt: at,
        putBy: operator,
      };
      const event: TrayEvent = {
        id: newId('tev'),
        trayId: target.trayId,
        type: 'replace',
        clockId: old.clockId,
        partId: old.partId,
        at,
        operator,
        note: payload.note?.trim() || undefined,
        slotCode: target.slotCode,
        fromTrayId: old.trayId,
        fromSlotCode: old.slotCode,
        toTrayId: target.trayId,
        toSlotCode: target.slotCode,
        newPartId: created.id,
      };
      await db.transaction('rw', db.parts, db.placements, db.trayEvents, async () => {
        await db.parts.put(toPlain(created));
        await db.placements.delete([old.trayId, old.slotCode]);
        await db.placements.put(toPlain(newPlacement));
        await db.trayEvents.put(toPlain(event));
      });
      // 同步零件台账缓存（内部只更新内存，不再写库）
      partStore.items = [...partStore.items, created];
      this.placements = [...this.placements.filter((p) => p.partId !== old.partId), newPlacement];
      this.events = [event, ...this.events];
      return created;
    },
  },
});
