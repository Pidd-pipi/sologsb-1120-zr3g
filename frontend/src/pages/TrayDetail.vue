<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useTrayStore } from '../stores/trayStore';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import {
  TRAY_ACTION_LABELS,
  TrayError,
  cellLabel,
  totalCells,
  type Tray,
  type TrayAction,
  type TrayPlacement,
} from '../types/tray';

const route = useRoute();
const router = useRouter();
const trayStore = useTrayStore();
const clockStore = useClockStore();
const partStore = usePartStore();

const OPERATOR_KEY = 'gbclockrepair:tray-operator';
const operator = ref('');
try {
  operator.value = window.localStorage.getItem(OPERATOR_KEY) ?? '';
} catch {
  /* localStorage 不可用时忽略 */
}
watch(operator, (v) => {
  try {
    window.localStorage.setItem(OPERATOR_KEY, v);
  } catch {
    /* ignore */
  }
});

const trayId = computed(() => String(route.params.id ?? ''));
const tray = computed(() => trayStore.byId(trayId.value));
const placements = computed(() => (tray.value ? trayStore.placementsByTray(tray.value.id) : []));
const events = computed(() => (tray.value ? trayStore.eventsByTray(tray.value.id) : []));

const selectedId = ref('');
const selected = computed<TrayPlacement | undefined>(() =>
  selectedId.value ? trayStore.placements.find((it) => it.id === selectedId.value) : undefined,
);

const cellMap = computed(() => new Map(placements.value.map((p) => [p.cellNo, p])));
const grid = computed(() => {
  if (!tray.value) return [] as number[];
  return Array.from({ length: totalCells(tray.value) }, (_, i) => i + 1);
});

function partName(id?: string): string {
  if (!id) return '—';
  return partStore.items.find((p) => p.id === id)?.name ?? '已删除零件';
}
function clockNoOf(id?: string): string {
  if (!id) return '—';
  return clockStore.byId(id)?.clockNo ?? '未知钟表';
}
function labelOf(trayIdForCell: string, cellNo?: number): string {
  if (cellNo === undefined) return '—';
  const t = trayStore.byId(trayIdForCell);
  return t ? cellLabel(cellNo, t.cols) : `#${cellNo}`;
}
const ACTION_TAG_TYPE: Record<TrayAction, 'success' | 'primary' | 'info' | 'warning' | 'danger'> = {
  place: 'success',
  move: 'primary',
  return: 'info',
  replace: 'warning',
  close: 'danger',
  reopen: 'success',
};

/* ---------------- 放入 ---------------- */
const placeVisible = ref(false);
const placeError = ref('');
const placeForm = reactive({ clockId: '', partId: '', cellNo: 1, note: '' });
const placePartOptions = computed(() =>
  partStore.items
    .filter((p) => p.clockId === placeForm.clockId && !trayStore.placementByPart(p.id))
    .map((p) => ({ id: p.id, label: `${p.name}（${p.wearState}/${p.decision}）` })),
);
const emptyCellOptions = computed(() => {
  if (!tray.value) return [];
  const used = new Set(placements.value.map((p) => p.cellNo));
  return grid.value
    .filter((n) => !used.has(n))
    .map((n) => ({ value: n, label: `${cellLabel(n, tray.value!.cols)}（第 ${n} 格）` }));
});
function openPlace(cellNo?: number) {
  if (!tray.value || tray.value.state !== 'open') return;
  placeError.value = '';
  placeForm.clockId = '';
  placeForm.partId = '';
  placeForm.note = '';
  const candidate = cellNo && !cellMap.value.has(cellNo) ? cellNo : emptyCellOptions.value[0]?.value;
  placeForm.cellNo = candidate ?? 1;
  placeVisible.value = true;
}
watch(() => placeForm.clockId, () => {
  placeForm.partId = placePartOptions.value[0]?.id ?? '';
});
async function submitPlace() {
  if (!operator.value.trim()) {
    placeError.value = '请填写操作人';
    return;
  }
  if (!placeForm.clockId) {
    placeError.value = '请选择钟表';
    return;
  }
  if (!placeForm.partId) {
    placeError.value = '请选择要放入的零件（该钟表零件可能均已在盘）';
    return;
  }
  try {
    await trayStore.placePart({
      trayId: trayId.value,
      cellNo: placeForm.cellNo,
      clockId: placeForm.clockId,
      partId: placeForm.partId,
      operator: operator.value.trim(),
      note: placeForm.note.trim(),
    });
    const placed = trayStore.placementByPart(placeForm.partId);
    selectedId.value = placed?.id ?? '';
    placeVisible.value = false;
    ElMessage.success('零件已放入格位');
  } catch (e) {
    placeError.value = e instanceof TrayError ? e.message : '操作失败';
  }
}

/* ---------------- 转格 ---------------- */
const moveVisible = ref(false);
const moveError = ref('');
const moveForm = reactive({ toTrayId: '', cellNo: 0, note: '' });
const moveTrayOptions = computed(() =>
  trayStore.trays
    .filter((t) => t.state === 'open')
    .map((t: Tray) => ({ id: t.id, label: `${t.trayNo}（${t.location}）` })),
);
const moveCellOptions = computed(() => {
  const target = trayStore.byId(moveForm.toTrayId);
  if (!target || !selected.value) return [];
  const used = new Set(trayStore.placementsByTray(target.id).map((p) => p.cellNo));
  return Array.from({ length: totalCells(target) }, (_, i) => i + 1)
    .filter((n) => !used.has(n))
    .filter((n) => !(target.id === selected.value!.trayId && n === selected.value!.cellNo))
    .map((n) => ({ value: n, label: `${cellLabel(n, target.cols)}（第 ${n} 格）` }));
});
function openMove() {
  if (!selected.value) return;
  moveError.value = '';
  moveForm.toTrayId = selected.value.trayId;
  moveForm.note = '';
  moveForm.cellNo = moveCellOptions.value[0]?.value ?? 0;
  moveVisible.value = true;
}
watch(() => moveForm.toTrayId, () => {
  moveForm.cellNo = moveCellOptions.value[0]?.value ?? 0;
});
async function submitMove() {
  if (!selected.value) return;
  if (!operator.value.trim()) {
    moveError.value = '请填写操作人';
    return;
  }
  if (!moveForm.cellNo) {
    moveError.value = '目标托盘没有空格位';
    return;
  }
  try {
    await trayStore.movePart({
      placementId: selected.value.id,
      toTrayId: moveForm.toTrayId,
      toCellNo: moveForm.cellNo,
      operator: operator.value.trim(),
      note: moveForm.note.trim(),
    });
    moveVisible.value = false;
    ElMessage.success('已转格');
  } catch (e) {
    moveError.value = e instanceof TrayError ? e.message : '操作失败';
  }
}

/* ---------------- 归还 ---------------- */
const returnVisible = ref(false);
const returnError = ref('');
const returnNote = ref('');
function openReturn() {
  returnError.value = '';
  returnNote.value = '';
  returnVisible.value = true;
}
async function submitReturn() {
  if (!selected.value) return;
  if (!operator.value.trim()) {
    returnError.value = '请填写操作人';
    return;
  }
  try {
    await trayStore.returnPart({
      placementId: selected.value.id,
      operator: operator.value.trim(),
      note: returnNote.value.trim(),
    });
    selectedId.value = '';
    returnVisible.value = false;
    ElMessage.success('已归还，格位释放');
  } catch (e) {
    returnError.value = e instanceof TrayError ? e.message : '操作失败';
  }
}

/* ---------------- 换新 ---------------- */
const replaceVisible = ref(false);
const replaceError = ref('');
const replaceForm = reactive({ newPartId: '', note: '' });
const replacePartOptions = computed(() => {
  if (!selected.value) return [];
  return partStore.items
    .filter((p) => p.clockId === selected.value!.clockId && p.id !== selected.value!.partId)
    .filter((p) => !trayStore.placementByPart(p.id))
    .map((p) => ({ id: p.id, label: `${p.name}（${p.wearState}/${p.decision}${p.sourceLot ? ` · ${p.sourceLot}` : ''}）` }));
});
function openReplace() {
  replaceError.value = '';
  replaceForm.newPartId = replacePartOptions.value[0]?.id ?? '';
  replaceForm.note = '';
  replaceVisible.value = true;
}
async function submitReplace() {
  if (!selected.value) return;
  if (!operator.value.trim()) {
    replaceError.value = '请填写操作人';
    return;
  }
  if (!replaceForm.newPartId) {
    replaceError.value = '没有可选的换新零件（同钟表且未在盘）';
    return;
  }
  try {
    await trayStore.replacePart({
      placementId: selected.value.id,
      newPartId: replaceForm.newPartId,
      operator: operator.value.trim(),
      note: replaceForm.note.trim(),
    });
    replaceVisible.value = false;
    ElMessage.success('已换新，旧件离盘');
  } catch (e) {
    replaceError.value = e instanceof TrayError ? e.message : '操作失败';
  }
}

/* ---------------- 关盘 / 重开 ---------------- */
async function closeTray() {
  if (!tray.value) return;
  if (placements.value.length > 0) {
    const lines = placements.value
      .map((p) => {
        const t = tray.value!;
        return `<div style="margin-top:6px"><b>${cellLabel(p.cellNo, t.cols)}</b>（第 ${p.cellNo} 格）｜${partName(p.partId)}｜${clockNoOf(p.clockId)}｜末次经手人 ${p.operator}｜${new Date(p.placedAt).toLocaleString('zh-CN')}</div>`;
      })
      .join('');
    await ElMessageBox.alert(
      `以下格位仍有未处理零件，请先归还、换新或转格：${lines}`,
      `无法关盘 · ${tray.value.trayNo}`,
      { dangerouslyUseHTMLString: true, confirmButtonText: '知道了', type: 'warning' },
    );
    return;
  }
  try {
    const { value } = await ElMessageBox.prompt(`托盘 ${tray.value.trayNo} 已无在盘零件，确认关盘？`, '关盘确认', {
      confirmButtonText: '关盘',
      cancelButtonText: '取消',
      inputPlaceholder: '请输入操作人',
      inputValue: operator.value,
      inputValidator: (v) => (v && v.trim() ? true : '操作人必填'),
    });
    operator.value = value;
    await trayStore.closeTray({ trayId: tray.value.id, operator: value.trim() });
    ElMessage.success('托盘已关盘');
  } catch (e) {
    if (e instanceof TrayError) ElMessage.error(e.message);
    /* 取消弹窗时忽略 */
  }
}

async function reopenTray() {
  if (!tray.value) return;
  try {
    const { value } = await ElMessageBox.prompt(`重新启用托盘 ${tray.value.trayNo}？`, '重开托盘', {
      confirmButtonText: '重开',
      cancelButtonText: '取消',
      inputPlaceholder: '请输入操作人',
      inputValue: operator.value,
      inputValidator: (v) => (v && v.trim() ? true : '操作人必填'),
    });
    operator.value = value;
    await trayStore.reopenTray({ trayId: tray.value.id, operator: value.trim() });
    ElMessage.success('托盘已重新在用');
  } catch (e) {
    if (e instanceof TrayError) ElMessage.error(e.message);
  }
}

function onCellClick(cellNo: number) {
  if (!tray.value || tray.value.state !== 'open') return;
  const p = cellMap.value.get(cellNo);
  if (p) selectedId.value = p.id;
  else openPlace(cellNo);
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await trayStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>托盘详情 · {{ tray?.trayNo ?? '未找到' }}</h2>
      <el-tag v-if="tray" :type="tray.state === 'open' ? 'success' : 'info'" effect="dark">
        {{ tray.state === 'open' ? '在用' : '已关盘' }}
      </el-tag>
      <el-tag v-if="tray" type="warning">{{ placements.length }} / {{ totalCells(tray) }} 格占用</el-tag>
      <div class="spacer" />
      <el-input v-model="operator" placeholder="操作人（记入流水）" class="operator-input" size="default" />
      <el-button v-if="tray?.state === 'open'" type="primary" @click="openPlace()">放入零件</el-button>
      <el-button v-if="tray?.state === 'open'" type="danger" plain @click="closeTray">关盘</el-button>
      <el-button v-if="tray?.state === 'closed'" type="success" plain @click="reopenTray">重开托盘</el-button>
      <el-button @click="router.push('/trays')">返回托盘列表</el-button>
    </div>

    <el-alert v-if="!tray" type="warning" :closable="false" title="未找到该托盘（可能已被删除）" show-icon />

    <template v-if="tray">
      <el-alert
        v-if="tray.state === 'closed'"
        type="info"
        :closable="false"
        :title="`托盘已于 ${tray.closedAt ? new Date(tray.closedAt).toLocaleString('zh-CN') : ''} 关盘，格位只读`"
        show-icon
      />

      <div class="grid">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>格位图</strong>
              <span class="muted">{{ tray.rows }} 行 × {{ tray.cols }} 列 · {{ tray.location || '未登记存放位置' }}</span>
            </div>
          </template>
          <div class="board" :style="{ gridTemplateColumns: `repeat(${tray.cols}, minmax(96px, 1fr))` }">
            <div
              v-for="n in grid"
              :key="n"
              class="cell"
              :class="{
                occupied: cellMap.has(n),
                selected: selected?.cellNo === n,
                disabled: tray.state !== 'open',
              }"
              @click="onCellClick(n)"
            >
              <div class="cell-label">{{ cellLabel(n, tray.cols) }}</div>
              <template v-if="cellMap.get(n)">
                <div class="cell-part">{{ partName(cellMap.get(n)!.partId) }}</div>
                <div class="cell-clock">{{ clockNoOf(cellMap.get(n)!.clockId) }}</div>
              </template>
              <div v-else class="cell-empty">空格</div>
            </div>
          </div>
        </el-card>

        <el-card shadow="never" class="side">
          <template #header><strong>格位详情</strong></template>
          <el-empty v-if="!selected" description="点击格位查看 / 放入零件" :image-size="70" />
          <template v-else>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="当前格位">
                {{ cellLabel(selected.cellNo, tray.cols) }}（第 {{ selected.cellNo }} 格）
              </el-descriptions-item>
              <el-descriptions-item label="零件">{{ partName(selected.partId) }}</el-descriptions-item>
              <el-descriptions-item label="所属钟表">{{ clockNoOf(selected.clockId) }}</el-descriptions-item>
              <el-descriptions-item label="末次经手人">{{ selected.operator }}</el-descriptions-item>
              <el-descriptions-item label="末次入格时间">
                {{ new Date(selected.placedAt).toLocaleString('zh-CN') }}
              </el-descriptions-item>
            </el-descriptions>
            <div class="cell-actions">
              <el-button size="small" type="primary" @click="openMove">转格</el-button>
              <el-button size="small" type="warning" @click="openReplace">换新</el-button>
              <el-button size="small" type="info" @click="openReturn">归还</el-button>
            </div>
          </template>
          <el-divider v-if="selected" />
          <div class="note-block">
            <div class="muted">托盘备注</div>
            <div>{{ tray.note || '—' }}</div>
          </div>
        </el-card>
      </div>

      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <strong>操作流水</strong>
            <el-tag size="small" type="info">{{ events.length }} 条</el-tag>
            <span class="muted">放入 / 转格 / 归还 / 换新全部留痕，只增不删</span>
          </div>
        </template>
        <el-table :data="events" size="small" border>
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ new Date(row.at).toLocaleString('zh-CN') }}</template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row }">
              <el-tag size="small" :type="ACTION_TAG_TYPE[row.action as TrayAction]">
                {{ TRAY_ACTION_LABELS[row.action as TrayAction] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="零件" min-width="150">
            <template #default="{ row }">
              <template v-if="row.action === 'replace'">
                {{ partName(row.replacedPartId) }}
                <span class="arrow">→</span>
                {{ partName(row.partId) }}
              </template>
              <template v-else>{{ partName(row.partId) }}</template>
            </template>
          </el-table-column>
          <el-table-column label="钟表" width="140">
            <template #default="{ row }">{{ clockNoOf(row.clockId) }}</template>
          </el-table-column>
          <el-table-column label="格位" min-width="130">
            <template #default="{ row }">
              <template v-if="row.action === 'move'">
                {{ labelOf(row.fromTrayId, row.fromCellNo) }}
                <span class="arrow">→</span>
                {{ labelOf(row.trayId, row.cellNo) }}
              </template>
              <template v-else-if="row.action === 'return'">
                {{ labelOf(row.trayId, row.cellNo) }} 离盘
              </template>
              <template v-else-if="row.cellNo === undefined">—</template>
              <template v-else>{{ labelOf(row.trayId, row.cellNo) }}</template>
            </template>
          </el-table-column>
          <el-table-column prop="operator" label="操作人" width="100" />
          <el-table-column prop="note" label="备注" min-width="160" show-overflow-tooltip />
        </el-table>
        <el-empty v-if="events.length === 0" description="暂无流水" :image-size="60" />
      </el-card>
    </template>

    <!-- 放入 -->
    <el-dialog v-model="placeVisible" title="放入零件" width="520px">
      <el-alert v-if="placeError" :title="placeError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form :model="placeForm" label-width="90px">
        <el-form-item label="钟表" required>
          <el-select v-model="placeForm.clockId" style="width: 100%" filterable>
            <el-option v-for="c in clockStore.items" :key="c.id" :label="c.clockNo" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="零件" required>
          <el-select v-model="placeForm.partId" style="width: 100%" :placeholder="placePartOptions.length ? '请选择' : '该钟表零件均已在盘'">
            <el-option v-for="p in placePartOptions" :key="p.id" :label="p.label" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="格位" required>
          <el-select v-model="placeForm.cellNo" style="width: 100%">
            <el-option v-for="opt in emptyCellOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="placeForm.note" type="textarea" :rows="2" placeholder="拆解下台原因等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="placeVisible = false">取消</el-button>
        <el-button type="primary" @click="submitPlace">放入</el-button>
      </template>
    </el-dialog>

    <!-- 转格 -->
    <el-dialog v-model="moveVisible" title="转格" width="520px">
      <el-alert v-if="moveError" :title="moveError" type="error" :closable="false" style="margin-bottom: 10px" />
      <div v-if="selected" class="dialog-context">
        {{ partName(selected.partId) }} 当前位于 {{ labelOf(selected.trayId, selected.cellNo) }}
      </div>
      <el-form :model="moveForm" label-width="90px">
        <el-form-item label="目标托盘" required>
          <el-select v-model="moveForm.toTrayId" style="width: 100%">
            <el-option v-for="t in moveTrayOptions" :key="t.id" :label="t.label" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标格位" required>
          <el-select v-model="moveForm.cellNo" style="width: 100%" :placeholder="moveCellOptions.length ? '请选择' : '目标托盘已满'">
            <el-option v-for="opt in moveCellOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="moveForm.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="moveVisible = false">取消</el-button>
        <el-button type="primary" @click="submitMove">转格</el-button>
      </template>
    </el-dialog>

    <!-- 归还 -->
    <el-dialog v-model="returnVisible" title="归还零件" width="520px">
      <el-alert v-if="returnError" :title="returnError" type="error" :closable="false" style="margin-bottom: 10px" />
      <div v-if="selected" class="dialog-context">
        {{ partName(selected.partId) }}（{{ clockNoOf(selected.clockId) }}）将从
        {{ labelOf(selected.trayId, selected.cellNo) }} 离盘并释放格位。
      </div>
      <el-form label-width="90px" style="margin-top: 12px">
        <el-form-item label="备注">
          <el-input v-model="returnNote" type="textarea" :rows="3" placeholder="装回机芯 / 交还藏家 / 送检等去向" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="returnVisible = false">取消</el-button>
        <el-button type="info" @click="submitReturn">确认归还</el-button>
      </template>
    </el-dialog>

    <!-- 换新 -->
    <el-dialog v-model="replaceVisible" title="换新零件" width="520px">
      <el-alert v-if="replaceError" :title="replaceError" type="error" :closable="false" style="margin-bottom: 10px" />
      <div v-if="selected" class="dialog-context">
        旧件 <b>{{ partName(selected.partId) }}</b> 离盘，新件顶入 {{ labelOf(selected.trayId, selected.cellNo) }}（格位不变）。
      </div>
      <el-form :model="replaceForm" label-width="90px" style="margin-top: 12px">
        <el-form-item label="换新零件" required>
          <el-select v-model="replaceForm.newPartId" style="width: 100%" :placeholder="replacePartOptions.length ? '请选择' : '同钟表下无其他在档零件'">
            <el-option v-for="p in replacePartOptions" :key="p.id" :label="p.label" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="replaceForm.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="replaceVisible = false">取消</el-button>
        <el-button type="warning" @click="submitReplace">确认换新</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.operator-input {
  width: 170px;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
  align-items: start;
}
.side {
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.board {
  display: grid;
  gap: 8px;
}
.cell {
  border: 1px solid #d8dde4;
  border-radius: 6px;
  padding: 6px 8px;
  min-height: 72px;
  background: #fafbfc;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.cell:hover {
  border-color: #409eff;
}
.cell.occupied {
  background: #fdf6ec;
  border-color: #e6a23c;
}
.cell.selected {
  border-color: #2f3a46;
  box-shadow: 0 0 0 2px rgba(47, 58, 70, 0.25);
}
.cell.disabled {
  cursor: not-allowed;
}
.cell-label {
  font-size: 12px;
  color: #94a0ad;
}
.cell-part {
  font-weight: 600;
  font-size: 14px;
  margin-top: 2px;
}
.cell-clock {
  font-size: 12px;
  color: #7b8592;
}
.cell-empty {
  margin-top: 10px;
  font-size: 12px;
  color: #b4bdc8;
  text-align: center;
}
.cell-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.note-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.dialog-context {
  background: #f4f6f8;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  color: #4c5663;
}
.arrow {
  color: #e6a23c;
  margin: 0 4px;
}
</style>
