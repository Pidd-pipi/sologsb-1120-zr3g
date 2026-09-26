// v2 → v3 迁移验证：先按旧结构建库灌数据，再用新版应用代码打开
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import Dexie from 'dexie';
import { createPinia, setActivePinia } from 'pinia';

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

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败：${msg}`);
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

// 1) 用旧版（v2）结构建同名库
const oldDb = new Dexie('gbclockrepair');
oldDb.version(2).stores({
  clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
  parts: 'id, clockId, name, wearState, decision, sourceLot',
  steps: 'id, clockId, seq, stepType, state, startedAt',
  tests: 'id, clockId, testedAt, conclusion',
});
const oldClock = { id: 'clk_old1', clockNo: 'CLK-1800-01', kind: '座钟', caliber: 'X1', createdAt: 1 };
const oldPart = { id: 'prt_old1', clockId: 'clk_old1', name: '摆轮', qtyNeeded: 1, position: '夹板下', wearState: '断裂', decision: '换新', sourceLot: 'OLD-LOT', dimension: 12 };
await oldDb.clocks.put(oldClock);
await oldDb.parts.put(oldPart);
await oldDb.close();
console.log('—— 已按 v2 结构建好旧库 ——');

// 2) 用新版应用代码打开（声明 v1/v2/v3，应自动迁移）
const { db, DB_VERSION } = await import('../src/utils/db');
assert(DB_VERSION === 3, '应用声明结构版本 v3');
assert((await db.clocks.count()) === 1, '迁移后 clocks 旧记录保留');
assert((await db.parts.count()) === 1, '迁移后 parts 旧记录保留');
const migrated = await db.parts.get('prt_old1');
assert(migrated?.sourceLot === 'OLD-LOT' && migrated.wearState === '断裂', '旧零件字段值原样未改写');
const tables = Array.from(db.tables.map((t) => t.name));
assert(tables.includes('trays') && tables.includes('placements') && tables.includes('trayEvents'), '新增三张托盘表');
assert((await db.trays.count()) === 0, '新表为空，不污染旧库');

// 3) 迁移后托盘功能可正常使用
setActivePinia(createPinia());
const { useTrayStore } = await import('../src/stores/trayStore');
const trayStore = useTrayStore();
await trayStore.load();
const tray = await trayStore.openTray({ name: 'T-01', rows: 2, cols: 2 }, '迁移测试员');
assert(tray.status === 'open', '迁移后的库可正常开盘');
assert((await db.trays.count()) === 1, '托盘数据正确写入 v3 库');
assert(trayStore.events[0].operator === '迁移测试员', '开盘流水记录操作人');

console.log(`\n全部 ${passed} 项迁移断言通过 ✅`);
process.exit(0);
