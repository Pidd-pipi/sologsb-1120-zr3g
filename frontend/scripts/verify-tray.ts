// 托盘追踪核心不变量运行时验证（Node + fake-indexeddb）
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createPinia, setActivePinia } from 'pinia';

// auto 入口已铺好 indexedDB / IDBKeyRange 等全局；这里替换为全新空库实例
(globalThis as any).indexedDB = new IDBFactory();
(globalThis as any).localStorage = {
  data: new Map<string, string>(),
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k) : null;
  },
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  },
};

const { db, ensureSeedData, DB_VERSION } = await import('../src/utils/db');
const { useTrayStore, TrayConflictError, TrayNotEmptyError } = await import('../src/stores/trayStore');
const { usePartStore } = await import('../src/stores/partStore');
const { useClockStore } = await import('../src/stores/clockStore');
const { slotCodesOf } = await import('../src/types/tray');

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败：${msg}`);
  passed += 1;
  console.log(`  ✓ ${msg}`);
}
async function expectThrow(fn: () => Promise<unknown>, ctor: Function, msg: string) {
  let err: unknown;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert(err instanceof ctor, msg);
}

setActivePinia(createPinia());
await ensureSeedData();
assert(DB_VERSION === 3, '数据库版本为 v3');

const clockStore = useClockStore();
const partStore = usePartStore();
const trayStore = useTrayStore();
await clockStore.load();
await partStore.load();
await trayStore.load();

console.log('—— 示范数据 ——');
assert(trayStore.trays.length === 2, '灌入 2 个示范托盘（1 开盘 + 1 关盘）');
assert(trayStore.openTrays.length === 1, '开盘中的托盘 1 个');
assert(trayStore.placements.length === 3, '在盘零件 3 件');
assert(partStore.items.length === 4, '零件台账 4 项（旧发条与新发条都保留）');
const open = trayStore.openTrays[0];
assert(slotCodesOf(open).length === 24, 'T-01 为 4×6 = 24 格');

const clockA = clockStore.items.find((c) => c.clockNo === 'CLK-1932-004')!;
const freePart = partStore.items.find((p) => p.clockId === clockA.id && !trayStore.placementOf(p.id))!;
console.log('—— 放入与唯一占用 ——');
const freeSlot = slotCodesOf(open).find((s) => !trayStore.placementAt(open.id, s))!;
await trayStore.putPart({
  trayId: open.id,
  clockId: clockA.id,
  partId: freePart.id,
  slotCode: freeSlot,
  operator: '张三',
  note: '运行时验证',
});
assert(!!trayStore.placementAt(open.id, freeSlot), '放入成功，格位被占');
const lastPut = trayStore.events[0];
assert(lastPut.type === 'put' && lastPut.operator === '张三', '流水记录了放入人与时间');

await expectThrow(
  () =>
    trayStore.putPart({
      trayId: open.id,
      clockId: clockA.id,
      partId: partStore.items[0].id,
      slotCode: freeSlot,
      operator: '张三',
    }),
  TrayConflictError,
  '同一格位不能同时占用两处',
);
await expectThrow(
  () =>
    trayStore.putPart({
      trayId: open.id,
      clockId: clockA.id,
      partId: freePart.id,
      slotCode: 'Z9',
      operator: '张三',
    }),
  TrayConflictError,
  '非法格位码被拒绝',
);
const anotherFree = slotCodesOf(open).find(
  (s) => !trayStore.placementAt(open.id, s) && s !== freeSlot,
)!;
await expectThrow(
  () =>
    trayStore.putPart({
      trayId: open.id,
      clockId: clockA.id,
      partId: freePart.id,
      slotCode: anotherFree,
      operator: '张三',
    }),
  TrayConflictError,
  '同一零件不能重复放入第二个格位',
);

console.log('—— 数据库层强制约束 ——');
let dbConstraintHit = false;
try {
  // 绕过 store 预检查，直接写库：&partId 唯一索引必须拦截
  await db.placements.put({
    trayId: open.id,
    slotCode: anotherFree,
    clockId: clockA.id,
    partId: freePart.id,
    putAt: Date.now(),
    putBy: '李四',
  });
} catch {
  dbConstraintHit = true;
}
assert(dbConstraintHit, 'IndexedDB 唯一索引 &partId 直接拦截双占');

console.log('—— 转格（同盘 + 跨盘）——');
const targetSlot = slotCodesOf(open).find(
  (s) => !trayStore.placementAt(open.id, s) && s !== freeSlot,
)!;
await trayStore.movePart({ partId: freePart.id, toTrayId: open.id, toSlotCode: targetSlot, operator: '李四' });
assert(!trayStore.placementAt(open.id, freeSlot), '转格后原格位释放');
assert(trayStore.placementOf(freePart.id)?.slotCode === targetSlot, '转格后落在新格位');
assert(trayStore.events[0].type === 'move' && trayStore.events[0].operator === '李四', '转格流水记录李四');

const secondTray = await trayStore.openTray({ name: 'T-09', rows: 2, cols: 3 }, '王五');
await trayStore.movePart({ partId: freePart.id, toTrayId: secondTray.id, toSlotCode: 'A1', operator: '王五' });
assert(trayStore.placementOf(freePart.id)?.trayId === secondTray.id, '跨盘转格成功');

console.log('—— 关盘拦截与具体格位点名 ——');
const closeErr = await (async () => {
  try {
    await trayStore.closeTray(secondTray.id, '王五');
    return null;
  } catch (e) {
    return e;
  }
})();
assert(closeErr instanceof TrayNotEmptyError, '有零件在盘时关盘被拒');
assert(
  closeErr instanceof TrayNotEmptyError && closeErr.slots.some((s) => s.slotCode === 'A1'),
  '错误信息点出具体格位 A1',
);
await trayStore.returnPart({ partId: freePart.id, operator: '王五', note: '装回' });
assert(!trayStore.placementOf(freePart.id), '归还后零件离盘');
await trayStore.closeTray(secondTray.id, '王五');
assert(trayStore.byId(secondTray.id)?.status === 'closed', '空盘可关盘');
assert(trayStore.events.some((e) => e.type === 'close' && e.operator === '王五'), '关盘流水记录王五');

await expectThrow(
  () =>
    trayStore.putPart({
      trayId: secondTray.id,
      clockId: clockA.id,
      partId: freePart.id,
      slotCode: 'A2',
      operator: '王五',
    }),
  TrayConflictError,
  '已关盘托盘不能再放入',
);

console.log('—— 换新：旧件保留、新件入台账并入格 ——');
const partInTray = trayStore.placements.find((p) => p.trayId === open.id)!;
const partCountBefore = partStore.items.length;
const created = await trayStore.replacePart(
  { partId: partInTray.partId, operator: '赵六', note: '换件验证' },
  {
    clockId: partInTray.clockId,
    name: '螺丝',
    qtyNeeded: 2,
    position: '夹板固定位',
    wearState: '完好',
    decision: '保留',
    sourceLot: 'SCR-99',
    dimension: 3,
  },
  { trayId: open.id, slotCode: 'D6' },
);
assert(partStore.items.length === partCountBefore + 1, '换新后零件台账新增 1 项（旧件不删）');
assert(!!partStore.items.find((p) => p.id === partInTray.partId), '旧零件记录仍保留');
assert(trayStore.placementOf(created.id)?.slotCode === 'D6', '新件占入目标格位 D6');
assert(!trayStore.placementOf(partInTray.partId), '旧件已离盘');
const replaceEvent = trayStore.events.find((e) => e.type === 'replace')!;
assert(
  replaceEvent.partId === partInTray.partId && replaceEvent.newPartId === created.id && replaceEvent.operator === '赵六',
  '换新流水同时关联旧件与新件、记录经手人',
);

console.log('—— 钟表维度查询 ——');
const clockEvents = trayStore.eventsByClock(clockA.id);
assert(clockEvents.length >= 5, '钟表详情可查到该钟全部历史流水（含已关盘）');
assert(trayStore.placementsOfClock(clockA.id).length >= 1, '可列出该钟当前在盘格位');

console.log(`\n全部 ${passed} 项断言通过 ✅`);
process.exit(0);
