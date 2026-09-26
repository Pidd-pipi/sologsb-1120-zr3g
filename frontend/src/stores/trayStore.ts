import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import {
  TrayError,
  cellLabel,
  totalCells,
  type Tray,
  type TrayDraft,
  type TrayEvent,
  type TrayPlacement,
} from '../types/tray';

interface TrayStateShape {
  trays: Tray[];
  placements: TrayPlacement[];
  events: TrayEvent[];
  loaded: boolean;
}

export const useTrayStore = defineStore('tray', {
  state: (): TrayStateShape => ({ trays: [], placements: [], events: [], loaded: false }),
  getters: {
    byId: (state) => (id: string) => state.trays.find((it) => it.id === id),
    placementsByTray: (state) => (trayId: string) =>
      state.placements.filter((it) => it.trayId === trayId).sort((a, b) => a.cellNo - b.cellNo),
    placementsByClock: (state) => (clockId: string) =>
      state.placements.filter((it) => it.clockId === clockId),
    placementByPart: (state) => (partId: string) => state.placements.find((it) => it.partId === partId),
    /** 托盘流水：含本盘发生的操作与从本盘转出的记录 */
    eventsByTray: (state) => (trayId: string) =>
      state.events.filter((it) => it.trayId === trayId || it.fromTrayId === trayId),
    eventsByClock: (state) => (clockId: string) => state.events.filter((it) => it.clockId === clockId),
    occupancy: (state) => (trayId: string) => state.placements.filter((it) => it.trayId === trayId).length,
  },
  actions: {
    async load() {
      this.trays = await db.trays.toArray();
      this.placements = await db.placements.toArray();
      const events = await db.trayEvents.toArray();
      this.events = events.sort((a, b) => b.at - a.at);
      this.loaded = true;
    },
    async addTray(draft: TrayDraft) {
      const trayNo = draft.trayNo.trim();
      if (!trayNo) throw new TrayError('托盘编号必填');
      if (this.trays.some((it) => it.trayNo === trayNo)) throw new TrayError(`托盘编号 ${trayNo} 已存在`);
      if (draft.rows < 1 || draft.cols < 1) throw new TrayError('行数和列数至少为 1');
      const record: Tray = { ...toPlain(draft), trayNo, state: 'open', id: newId('try'), createdAt: Date.now() };
      await db.trays.put(toPlain(record));
      this.trays = [...this.trays, record];
      return record;
    },
    /** 放入：零件入格。格位与零件双重唯一校验在事务内完成 */
    async placePart(input: { trayId: string; cellNo: number; partId: string; clockId: string; operator: string; note?: string }) {
      const now = Date.now();
      const placement: TrayPlacement = {
        id: newId('plc'),
        trayId: input.trayId,
        cellNo: input.cellNo,
        clockId: input.clockId,
        partId: input.partId,
        operator: input.operator,
        placedAt: now,
      };
      const event: TrayEvent = {
        id: newId('tev'),
        trayId: input.trayId,
        action: 'place',
        cellNo: input.cellNo,
        clockId: input.clockId,
        partId: input.partId,
        operator: input.operator,
        at: now,
        note: input.note ?? '',
      };
      await db.transaction('rw', db.trays, db.placements, db.trayEvents, async () => {
        const tray = await db.trays.get(input.trayId);
        if (!tray) throw new TrayError('托盘不存在');
        if (tray.state !== 'open') throw new TrayError(`托盘 ${tray.trayNo} 已关盘，无法放入`);
        if (input.cellNo < 1 || input.cellNo > totalCells(tray))
          throw new TrayError(`格位 ${input.cellNo} 超出范围（1–${totalCells(tray)}）`);
        const cellUsed = await db.placements.where('[trayId+cellNo]').equals([input.trayId, input.cellNo]).first();
        if (cellUsed) throw new TrayError(`格位 ${cellLabel(input.cellNo, tray.cols)} 已被占用，同一格位不能放两件`);
        const partUsed = await db.placements.where('partId').equals(input.partId).first();
        if (partUsed) {
          const holder = await db.trays.get(partUsed.trayId);
          throw new TrayError(
            `该零件已在托盘 ${holder?.trayNo ?? '?'} 格位 ${cellLabel(partUsed.cellNo, holder?.cols ?? 1)}，不能同时占用两处`,
          );
        }
        await db.placements.put(toPlain(placement));
        await db.trayEvents.put(toPlain(event));
      });
      this.placements = [...this.placements, placement];
      this.events = [event, ...this.events];
    },
    /** 转格：在盘零件移到其他格位/托盘 */
    async movePart(input: { placementId: string; toTrayId: string; toCellNo: number; operator: string; note?: string }) {
      const now = Date.now();
      let updated: TrayPlacement | undefined;
      let event: TrayEvent | undefined;
      await db.transaction('rw', db.trays, db.placements, db.trayEvents, async () => {
        const placement = await db.placements.get(input.placementId);
        if (!placement) throw new TrayError('该零件当前不在任何托盘中');
        if (placement.trayId === input.toTrayId && placement.cellNo === input.toCellNo)
          throw new TrayError('目标格位与当前格位相同');
        const target = await db.trays.get(input.toTrayId);
        if (!target) throw new TrayError('目标托盘不存在');
        if (target.state !== 'open') throw new TrayError(`托盘 ${target.trayNo} 已关盘，无法转入`);
        if (input.toCellNo < 1 || input.toCellNo > totalCells(target))
          throw new TrayError(`格位 ${input.toCellNo} 超出范围（1–${totalCells(target)}）`);
        const cellUsed = await db.placements.where('[trayId+cellNo]').equals([input.toTrayId, input.toCellNo]).first();
        if (cellUsed) throw new TrayError(`目标格位 ${cellLabel(input.toCellNo, target.cols)} 已被占用`);
        updated = { ...placement, trayId: input.toTrayId, cellNo: input.toCellNo, operator: input.operator, placedAt: now };
        event = {
          id: newId('tev'),
          trayId: input.toTrayId,
          action: 'move',
          cellNo: input.toCellNo,
          clockId: placement.clockId,
          partId: placement.partId,
          fromTrayId: placement.trayId,
          fromCellNo: placement.cellNo,
          operator: input.operator,
          at: now,
          note: input.note ?? '',
        };
        await db.placements.put(toPlain(updated));
        await db.trayEvents.put(toPlain(event));
      });
      if (updated && event) {
        const next = updated;
        this.placements = this.placements.map((it) => (it.id === next.id ? next : it));
        this.events = [event, ...this.events];
      }
    },
    /** 归还：零件离盘（装回机芯/交还），格位释放 */
    async returnPart(input: { placementId: string; operator: string; note?: string }) {
      const now = Date.now();
      let removed: TrayPlacement | undefined;
      let event: TrayEvent | undefined;
      await db.transaction('rw', db.placements, db.trayEvents, async () => {
        const placement = await db.placements.get(input.placementId);
        if (!placement) throw new TrayError('该零件当前不在任何托盘中');
        removed = placement;
        event = {
          id: newId('tev'),
          trayId: placement.trayId,
          action: 'return',
          cellNo: placement.cellNo,
          clockId: placement.clockId,
          partId: placement.partId,
          operator: input.operator,
          at: now,
          note: input.note ?? '',
        };
        await db.placements.delete(placement.id);
        await db.trayEvents.put(toPlain(event));
      });
      if (removed && event) {
        const gone = removed;
        this.placements = this.placements.filter((it) => it.id !== gone.id);
        this.events = [event, ...this.events];
      }
    },
    /** 换新：旧件离盘，新件（同钟表的另一零件条目）顶入同一格位 */
    async replacePart(input: { placementId: string; newPartId: string; operator: string; note?: string }) {
      const now = Date.now();
      let updated: TrayPlacement | undefined;
      let event: TrayEvent | undefined;
      await db.transaction('rw', db.trays, db.placements, db.trayEvents, db.parts, async () => {
        const placement = await db.placements.get(input.placementId);
        if (!placement) throw new TrayError('该零件当前不在任何托盘中');
        if (placement.partId === input.newPartId) throw new TrayError('新旧零件相同，无需换新');
        const part = await db.parts.get(input.newPartId);
        if (!part) throw new TrayError('换新零件不存在');
        if (part.clockId !== placement.clockId) throw new TrayError('换新零件必须属于同一台钟表');
        const partUsed = await db.placements.where('partId').equals(input.newPartId).first();
        if (partUsed) {
          const holder = await db.trays.get(partUsed.trayId);
          throw new TrayError(
            `换新零件已在托盘 ${holder?.trayNo ?? '?'} 格位 ${cellLabel(partUsed.cellNo, holder?.cols ?? 1)}，不能同时占用两处`,
          );
        }
        updated = { ...placement, partId: input.newPartId, operator: input.operator, placedAt: now };
        event = {
          id: newId('tev'),
          trayId: placement.trayId,
          action: 'replace',
          cellNo: placement.cellNo,
          clockId: placement.clockId,
          partId: input.newPartId,
          replacedPartId: placement.partId,
          operator: input.operator,
          at: now,
          note: input.note ?? '',
        };
        await db.placements.put(toPlain(updated));
        await db.trayEvents.put(toPlain(event));
      });
      if (updated && event) {
        const next = updated;
        this.placements = this.placements.map((it) => (it.id === next.id ? next : it));
        this.events = [event, ...this.events];
      }
    },
    /** 关盘：仍有未处理零件时抛错并列出具体格位 */
    async closeTray(input: { trayId: string; operator: string; note?: string }) {
      const now = Date.now();
      let event: TrayEvent | undefined;
      await db.transaction('rw', db.trays, db.placements, db.trayEvents, async () => {
        const tray = await db.trays.get(input.trayId);
        if (!tray) throw new TrayError('托盘不存在');
        if (tray.state === 'closed') throw new TrayError(`托盘 ${tray.trayNo} 已是关盘状态`);
        const remaining = await db.placements.where('trayId').equals(input.trayId).toArray();
        if (remaining.length > 0) {
          const cells = remaining
            .map((it) => it.cellNo)
            .sort((a, b) => a - b)
            .map((no) => cellLabel(no, tray.cols))
            .join('、');
          throw new TrayError(`关盘失败：格位 ${cells} 仍有未处理零件，请先归还或转格`);
        }
        await db.trays.update(tray.id, { state: 'closed', closedAt: now });
        event = {
          id: newId('tev'),
          trayId: tray.id,
          action: 'close',
          operator: input.operator,
          at: now,
          note: input.note ?? '',
        };
        await db.trayEvents.put(toPlain(event));
      });
      if (event) {
        this.trays = this.trays.map((it) => (it.id === input.trayId ? { ...it, state: 'closed', closedAt: now } : it));
        this.events = [event, ...this.events];
      }
    },
    /** 重开：关盘后重新启用 */
    async reopenTray(input: { trayId: string; operator: string; note?: string }) {
      const now = Date.now();
      let event: TrayEvent | undefined;
      await db.transaction('rw', db.trays, db.trayEvents, async () => {
        const tray = await db.trays.get(input.trayId);
        if (!tray) throw new TrayError('托盘不存在');
        if (tray.state === 'open') throw new TrayError(`托盘 ${tray.trayNo} 本就在用`);
        await db.trays.update(tray.id, { state: 'open', closedAt: undefined });
        event = {
          id: newId('tev'),
          trayId: tray.id,
          action: 'reopen',
          operator: input.operator,
          at: now,
          note: input.note ?? '',
        };
        await db.trayEvents.put(toPlain(event));
      });
      if (event) {
        this.trays = this.trays.map((it) => (it.id === input.trayId ? { ...it, state: 'open', closedAt: undefined } : it));
        this.events = [event, ...this.events];
      }
    },
  },
});
