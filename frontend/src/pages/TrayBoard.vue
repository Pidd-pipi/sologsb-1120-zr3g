<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useTrayStore, TrayConflictError, TrayNotEmptyError } from '../stores/trayStore';
import { useOperatorStore } from '../stores/operatorStore';
import TrayEventLog from '../components/common/TrayEventLog.vue';
import { clockColor, formatDateTime } from '../utils/format';
import { slotCodesOf, type SlotPlacement } from '../types/tray';
import {
  PART_DECISIONS,
  PART_NAMES,
  WEAR_STATES,
  type MovementPartDraft,
  type PartDecision,
  type PartName,
  type WearState,
} from '../types/part';

const clockStore = useClockStore();
const partStore = usePartStore();
const trayStore = useTrayStore();
const operatorStore = useOperatorStore();
const route = useRoute();

type DialogKind = 'put' | 'move' | 'return' | 'replace' | null;
const dialog = ref<DialogKind>(null);
const putVisible = computed({
  get: () => dialog.value === 'put',
  set: (v: boolean) => {
    if (!v) dialog.value = null;
  },
});
const moveVisible = computed({
  get: () => dialog.value === 'move',
  set: (v: boolean) => {
    if (!v) dialog.value = null;
  },
});
const returnVisible = computed({
  get: () => dialog.value === 'return',
  set: (v: boolean) => {
    if (!v) dialog.value = null;
  },
});
const replaceVisible = computed({
  get: () => dialog.value === 'replace',
  set: (v: boolean) => {
    if (!v) dialog.value = null;
  },
});
const selectedSlot = ref('');
const selectedPartId = ref('');
const note = ref('');
const formError = ref('');

const newTrayVisible = ref(false);
const newTrayForm = reactive({ name: '', rows: 4, cols: 6 });

const putForm = reactive({ clockId: '', partId: '' });

const replaceForm = reactive<MovementPartDraft>({
  clockId: '',
  name: '发条',
  qtyNeeded: 1,
  position: '',
  wearState: '完好',
  decision: '保留',
  sourceLot: '',
  dimension: 1,
});
const replaceTarget = reactive({ trayId: '', slotCode: '' });

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await trayStore.load();
  const queryTray = String(route.query.trayId ?? '');
  if (queryTray && trayStore.byId(queryTray)) {
    currentTrayId.value = queryTray;
  } else if (!currentTrayId.value && trayStore.trays.length > 0) {
    currentTrayId.value = trayStore.trays[0].id;
  }
});

const trayOptions = computed(() => trayStore.trays);
const currentTrayId = ref('');
const currentTray = computed(() => trayStore.byId(currentTrayId.value));
const currentSlots = computed(() => (currentTray.value ? slotCodesOf(currentTray.value) : []));
const trayPlacements = computed(() =>
  currentTray.value ? trayStore.placementsOfTray(currentTray.value.id) : [],
);

function onTrayChange() {
  selectedPartId.value = '';
  selectedSlot.value = '';
}

function placementAt(slot: string): SlotPlacement | undefined {
  return currentTray.value ? trayStore.placementAt(currentTray.value.id, slot) : undefined;
}
function clockNoOf(id: string): string {
  return clockStore.byId(id)?.clockNo ?? '未知钟表';
}
function partOf(id: string) {
  return partStore.items.find((p) => p.id === id);
}
function onCell(slot: string) {
  if (!currentTray.value || currentTray.value.status !== 'open') return;
  const p = placementAt(slot);
  selectedSlot.value = slot;
  selectedPartId.value = p ? p.partId : '';
}

/** 未在任何格位中的零件才可放入（同一零件不能同时占两处） */
const puttableParts = computed(() =>
  partStore.items.filter((p) => !trayStore.placementOf(p.id)),
);
const partsOfPutClock = computed(() =>
  puttableParts.value.filter((p) => p.clockId === putForm.clockId),
);

// 切换钟表后清空已选零件，避免跨钟表串选
watch(
  () => putForm.clockId,
  () => {
    putForm.partId = '';
  },
);

function openNewTray() {
  newTrayForm.name = `T-${String(trayStore.trays.length + 1).padStart(2, '0')}`;
  newTrayForm.rows = 4;
  newTrayForm.cols = 6;
  newTrayVisible.value = true;
}
async function submitNewTray() {
  try {
    const created = await trayStore.openTray({ ...newTrayForm }, operatorStore.current);
    newTrayVisible.value = false;
    currentTrayId.value = created.id;
    ElMessage.success(`托盘 ${created.name} 已开盘，经手人：${operatorStore.current}`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '开盘失败');
  }
}

function openPut(slot?: string) {
  formError.value = '';
  note.value = '';
  selectedSlot.value = slot ?? '';
  selectedPartId.value = '';
  putForm.clockId = clockStore.items[0]?.id ?? '';
  putForm.partId = '';
  dialog.value = 'put';
}

async function submitPut() {
  formError.value = '';
  try {
    await trayStore.putPart({
      trayId: currentTrayId.value,
      clockId: putForm.clockId,
      partId: putForm.partId,
      slotCode: selectedSlot.value,
      operator: operatorStore.current,
      note: note.value,
    });
    dialog.value = null;
    selectedPartId.value = putForm.partId;
    ElMessage.success(`已放入格位 ${selectedSlot.value}`);
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '放入失败';
  }
}

function openMove() {
  formError.value = '';
  note.value = '';
  dialog.value = 'move';
}
async function submitMove(targetTrayId: string, targetSlot: string) {
  formError.value = '';
  try {
    await trayStore.movePart({
      partId: selectedPartId.value,
      toTrayId: targetTrayId,
      toSlotCode: targetSlot,
      operator: operatorStore.current,
      note: note.value,
    });
    dialog.value = null;
    ElMessage.success('转格完成');
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '转格失败';
  }
}

function openReturn() {
  formError.value = '';
  note.value = '';
  dialog.value = 'return';
}
async function submitReturn() {
  formError.value = '';
  try {
    await trayStore.returnPart({
      partId: selectedPartId.value,
      operator: operatorStore.current,
      note: note.value,
    });
    dialog.value = null;
    selectedPartId.value = '';
    ElMessage.success('零件已归还机芯');
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '归还失败';
  }
}

const selectedPlacement = computed(() =>
  selectedPartId.value ? trayStore.placementOf(selectedPartId.value) : undefined,
);

function openReplace() {
  formError.value = '';
  note.value = '';
  const oldPlacement = selectedPlacement.value;
  if (!oldPlacement) return;
  const oldPart = partOf(oldPlacement.partId);
  replaceForm.clockId = oldPlacement.clockId;
  replaceForm.name = (oldPart?.name ?? '发条') as PartName;
  replaceForm.qtyNeeded = oldPart?.qtyNeeded ?? 1;
  replaceForm.position = oldPart?.position ?? '';
  replaceForm.wearState = '完好';
  replaceForm.decision = '保留';
  replaceForm.sourceLot = '';
  replaceForm.dimension = oldPart?.dimension ?? 1;
  replaceTarget.trayId = oldPlacement.trayId;
  replaceTarget.slotCode = oldPlacement.slotCode;
  dialog.value = 'replace';
}
async function submitReplace() {
  formError.value = '';
  if (!replaceForm.position.trim()) {
    formError.value = '请填写新件装配位置';
    return;
  }
  try {
    const created = await trayStore.replacePart(
      { partId: selectedPartId.value, operator: operatorStore.current, note: note.value },
      {
        ...replaceForm,
        position: replaceForm.position.trim(),
        sourceLot: replaceForm.sourceLot.trim(),
      },
      { trayId: replaceTarget.trayId, slotCode: replaceTarget.slotCode },
    );
    dialog.value = null;
    currentTrayId.value = replaceTarget.trayId;
    selectedSlot.value = replaceTarget.slotCode;
    selectedPartId.value = created.id;
    ElMessage.success(`换新完成：新件 ${created.name} 已入格位 ${replaceTarget.slotCode}`);
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '换新失败';
  }
}

async function closeTray() {
  if (!currentTray.value) return;
  try {
    await ElMessageBox.confirm(
      `确认关盘 ${currentTray.value.name}？关盘后只读，不能再放入或转格。`,
      '关盘确认',
      { type: 'warning', confirmButtonText: '确认关盘', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await trayStore.closeTray(currentTray.value.id, operatorStore.current);
    ElMessage.success('托盘已关盘');
  } catch (e) {
    if (e instanceof TrayNotEmptyError) {
      const vnodes = [
        h('p', { style: 'margin: 0 0 8px' }, `还有 ${e.slots.length} 件零件未处理，请先归还或换新后再关盘：`),
        h(
          'ul',
          { style: 'margin: 0; padding-left: 20px' },
          e.slots.map((s) => {
            const part = partOf(s.partId);
            return h('li', { style: 'margin-bottom: 4px' }, [
              h('strong', `格位 ${s.slotCode}`),
              `：${clockNoOf(s.clockId)} · ${part?.name ?? '未知零件'}（末次经手 ${s.putBy}，${formatDateTime(s.putAt)}）`,
            ]);
          }),
        ),
      ];
      await ElMessageBox.alert(h('div', vnodes), '无法关盘：存在未处理零件', {
        type: 'error',
        confirmButtonText: '知道了',
      });
      return;
    }
    if (e instanceof TrayConflictError) {
      ElMessage.error(e.message);
      return;
    }
    throw e;
  }
}

const moveTargetTrayId = ref('');
const moveTargetSlot = ref('');
const moveTargetTray = computed(() => trayStore.byId(moveTargetTrayId.value));
const freeSlotsOfMoveTarget = computed(() => {
  const tray = moveTargetTray.value;
  if (!tray) return [] as string[];
  return slotCodesOf(tray).filter((code) => !trayStore.placementAt(tray.id, code));
});
function prepareMoveDialog() {
  moveTargetTrayId.value = currentTrayId.value;
  moveTargetSlot.value = '';
  openMove();
}
// 转格目标托盘变了，原格位码不再适用
watch(moveTargetTrayId, () => {
  moveTargetSlot.value = '';
});

function fillReplaceTarget(slot: string) {
  replaceTarget.slotCode = slot;
}
// 换新目标托盘变了，目标格位随之清空
watch(
  () => replaceTarget.trayId,
  () => {
    replaceTarget.slotCode = '';
  },
);
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>托盘追踪</h2>
      <el-tag>在盘零件 {{ trayStore.placements.length }} 件</el-tag>
      <el-tag type="success" effect="plain">开盘中 {{ trayStore.openTrays.length }} 个</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="openNewTray">开新托盘</el-button>
    </div>

    <el-card shadow="never" class="toolbar">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="托盘">
          <el-select v-model="currentTrayId" style="width: 240px" @change="onTrayChange">
            <el-option
              v-for="t in trayOptions"
              :key="t.id"
              :value="t.id"
              :label="`${t.name}（${t.status === 'open' ? '开盘中' : '已关盘'}）`"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="currentTray">
          <el-tag :type="currentTray.status === 'open' ? 'success' : 'info'">
            {{ currentTray.status === 'open' ? '开盘中' : '已关盘' }}
          </el-tag>
          <span class="muted" style="margin-left: 10px">
            {{ currentTray.rows }}×{{ currentTray.cols }} · {{ trayPlacements.length }} 件在盘
          </span>
        </el-form-item>
        <el-form-item v-if="currentTray?.status === 'open'">
          <el-button type="danger" plain @click="closeTray">关盘</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-empty v-if="!currentTray" description="还没有托盘，点击右上角开新托盘" />

    <template v-else>
      <div class="board">
        <el-card shadow="never" class="grid-card">
          <template #header>
            <div class="card-head">
              <strong>{{ currentTray.name }} 格位图</strong>
              <el-tag size="small" type="info">{{ trayPlacements.length }}/{{ currentSlots.length }} 占用</el-tag>
              <el-button v-if="currentTray.status === 'open'" size="small" type="primary" plain @click="openPut()">
                放入空格
              </el-button>
            </div>
          </template>
          <div class="grid" :style="{ gridTemplateColumns: `repeat(${currentTray.cols}, minmax(108px, 1fr))` }">
            <div
              v-for="slot in currentSlots"
              :key="slot"
              class="cell"
              :class="{
                filled: !!placementAt(slot),
                selected: selectedSlot === slot,
                readonly: currentTray.status !== 'open',
              }"
              :style="placementAt(slot) ? { borderColor: clockColor(placementAt(slot)!.clockId) } : {}"
              @click="onCell(slot)"
            >
              <div class="cell-slot">{{ slot }}</div>
              <template v-if="placementAt(slot)">
                <div class="cell-clock" :style="{ color: clockColor(placementAt(slot)!.clockId) }">
                  {{ clockNoOf(placementAt(slot)!.clockId) }}
                </div>
                <div class="cell-part">{{ partOf(placementAt(slot)!.partId)?.name ?? '未知零件' }}</div>
              </template>
              <div v-else class="cell-empty">空</div>
            </div>
          </div>
        </el-card>

        <el-card shadow="never" class="detail-card">
          <template #header><strong>格位操作</strong></template>
          <template v-if="!selectedSlot">
            <el-empty description="点击格位图选择格位" :image-size="70" />
          </template>
          <template v-else>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="格位">{{ selectedSlot }}</el-descriptions-item>
              <el-descriptions-item v-if="selectedPlacement" label="占用">
                <el-tag size="small" :color="clockColor(selectedPlacement.clockId)" style="color: #fff; border: none">
                  {{ clockNoOf(selectedPlacement.clockId) }}
                </el-tag>
                {{ partOf(selectedPlacement.partId)?.name ?? '未知零件' }}
              </el-descriptions-item>
              <el-descriptions-item v-else label="占用">空格位</el-descriptions-item>
              <el-descriptions-item v-if="selectedPlacement" label="放入时间 / 经手人">
                {{ formatDateTime(selectedPlacement.putAt) }} · {{ selectedPlacement.putBy }}
              </el-descriptions-item>
            </el-descriptions>
            <div v-if="currentTray.status === 'open'" class="actions">
              <el-button v-if="!selectedPlacement" type="primary" @click="openPut(selectedSlot)">放入零件</el-button>
              <template v-else>
                <el-button type="warning" @click="prepareMoveDialog">转格</el-button>
                <el-button type="success" @click="openReturn">归还</el-button>
                <el-button type="danger" plain @click="openReplace">换新</el-button>
              </template>
            </div>
            <el-alert
              v-else
              type="info"
              :closable="false"
              title="托盘已关盘，格位只读"
              show-icon
              style="margin-top: 10px"
            />
          </template>
        </el-card>
      </div>

      <el-card shadow="never">
        <template #header><strong>{{ currentTray.name }} 托盘流水</strong></template>
        <TrayEventLog :tray-id="currentTray.id" empty-text="本托盘暂无流水" />
      </el-card>
    </template>

    <!-- 开新托盘 -->
    <el-dialog v-model="newTrayVisible" title="开新托盘" width="420px">
      <el-form label-width="90px">
        <el-form-item label="托盘名称" required>
          <el-input v-model="newTrayForm.name" placeholder="如 T-02" />
        </el-form-item>
        <el-form-item label="行数">
          <el-input-number v-model="newTrayForm.rows" :min="1" :max="26" />
        </el-form-item>
        <el-form-item label="列数">
          <el-input-number v-model="newTrayForm.cols" :min="1" :max="50" />
        </el-form-item>
        <el-form-item label="开盘人">
          <el-tag>{{ operatorStore.current }}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="newTrayVisible = false">取消</el-button>
        <el-button type="primary" @click="submitNewTray">开盘</el-button>
      </template>
    </el-dialog>

    <!-- 放入 -->
    <el-dialog v-model="putVisible" title="放入零件" width="520px">
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form label-width="90px">
        <el-form-item label="目标格位" required>
          <el-input v-model="selectedSlot" placeholder="如 A1，可直接点击格位图带出" />
        </el-form-item>
        <el-form-item label="钟表" required>
          <el-select v-model="putForm.clockId" style="width: 100%">
            <el-option v-for="c in clockStore.items" :key="c.id" :label="c.clockNo" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="零件" required>
          <el-select v-model="putForm.partId" style="width: 100%" :placeholder="partsOfPutClock.length ? '选择零件' : '该钟表零件均已在盘'">
            <el-option
              v-for="p in partsOfPutClock"
              :key="p.id"
              :label="`${p.name} · ${p.position}（${p.wearState}）`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="note" type="textarea" :rows="2" placeholder="如 清洗后待配" />
        </el-form-item>
        <el-form-item label="操作人">
          <el-tag>{{ operatorStore.current }}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = null">取消</el-button>
        <el-button type="primary" @click="submitPut">确认放入</el-button>
      </template>
    </el-dialog>

    <!-- 转格 -->
    <el-dialog v-model="moveVisible" title="转格" width="520px">
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form label-width="90px">
        <el-form-item label="零件">
          <el-tag>{{ partOf(selectedPartId)?.name ?? '' }}</el-tag>
          <span class="muted" style="margin-left: 8px">
            当前 {{ currentTray?.name }} {{ selectedPlacement?.slotCode }}
          </span>
        </el-form-item>
        <el-form-item label="目标托盘">
          <el-select v-model="moveTargetTrayId" style="width: 100%">
            <el-option
              v-for="t in trayStore.openTrays"
              :key="t.id"
              :label="`${t.name}（${t.rows}×${t.cols}）`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="目标格位" required>
          <el-select v-model="moveTargetSlot" style="width: 100%" placeholder="仅列出空格位">
            <el-option v-for="s in freeSlotsOfMoveTarget" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="note" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="操作人">
          <el-tag>{{ operatorStore.current }}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = null">取消</el-button>
        <el-button
          type="warning"
          :disabled="!moveTargetSlot || !moveTargetTray || moveTargetTray.status !== 'open'"
          @click="submitMove(moveTargetTrayId, moveTargetSlot)"
        >
          确认转格
        </el-button>
      </template>
    </el-dialog>

    <!-- 归还 -->
    <el-dialog v-model="returnVisible" title="归还零件" width="480px">
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-alert
        type="info"
        :closable="false"
        show-icon
        :title="`将 ${partOf(selectedPartId)?.name ?? ''} 从格位 ${selectedPlacement?.slotCode ?? ''} 取出并装回机芯`"
        style="margin-bottom: 10px"
      />
      <el-form label-width="90px">
        <el-form-item label="备注">
          <el-input v-model="note" type="textarea" :rows="2" placeholder="如 装入条盒试走正常" />
        </el-form-item>
        <el-form-item label="操作人">
          <el-tag>{{ operatorStore.current }}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = null">取消</el-button>
        <el-button type="success" @click="submitReturn">确认归还</el-button>
      </template>
    </el-dialog>

    <!-- 换新 -->
    <el-dialog v-model="replaceVisible" title="换新（旧件出盘 · 新件登记）" width="600px">
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        :title="`旧件 ${partOf(selectedPartId)?.name ?? ''} 保留历史记录；新件将登记入零件台账并占入目标格位`"
        style="margin-bottom: 12px"
      />
      <el-form label-width="100px">
        <el-form-item label="目标托盘">
          <el-select v-model="replaceTarget.trayId" style="width: 100%">
            <el-option
              v-for="t in trayStore.openTrays"
              :key="t.id"
              :label="`${t.name}（${t.rows}×${t.cols}）`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="目标格位" required>
          <el-select :model-value="replaceTarget.slotCode" style="width: 100%" @update:model-value="fillReplaceTarget(String($event))">
            <el-option
              v-for="s in slotCodesOf(trayStore.byId(replaceTarget.trayId) ?? { rows: 0, cols: 0 })"
              :key="s"
              :label="`${s}${trayStore.placementAt(replaceTarget.trayId, s) ? '（占用）' : ''}`"
              :value="s"
              :disabled="!!trayStore.placementAt(replaceTarget.trayId, s)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="新件名称">
          <el-select v-model="replaceForm.name" style="width: 100%">
            <el-option v-for="n in PART_NAMES" :key="n" :label="n" :value="n" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量">
          <el-input-number v-model="replaceForm.qtyNeeded" :min="1" :max="999" />
        </el-form-item>
        <el-form-item label="装配位置" required>
          <el-input v-model="replaceForm.position" placeholder="如 条盒内" />
        </el-form-item>
        <el-form-item label="磨损状态">
          <el-select v-model="replaceForm.wearState" style="width: 100%">
            <el-option v-for="w in WEAR_STATES" :key="w" :label="w" :value="w" />
          </el-select>
        </el-form-item>
        <el-form-item label="处理决定">
          <el-select v-model="replaceForm.decision" style="width: 100%">
            <el-option v-for="d in PART_DECISIONS" :key="d" :label="d" :value="d" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源批号">
          <el-input v-model="replaceForm.sourceLot" placeholder="如 MS-2026-09" />
        </el-form-item>
        <el-form-item label="关键尺寸 mm">
          <el-input-number v-model="replaceForm.dimension" :min="0" :max="200" :step="0.1" :precision="2" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="note" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="操作人">
          <el-tag>{{ operatorStore.current }}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = null">取消</el-button>
        <el-button type="danger" @click="submitReplace">确认换新</el-button>
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
.muted {
  color: #7b8592;
  font-size: 13px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.board {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
  align-items: start;
}
.grid {
  display: grid;
  gap: 8px;
}
.cell {
  border: 2px solid #d9dfe6;
  border-radius: 6px;
  padding: 6px 8px;
  min-height: 64px;
  cursor: pointer;
  background: #fafbfc;
  transition: box-shadow 0.15s;
}
.cell:hover {
  box-shadow: 0 0 0 2px rgba(47, 111, 176, 0.25);
}
.cell.selected {
  box-shadow: 0 0 0 2px #2f6fb0;
}
.cell.readonly {
  cursor: default;
}
.cell.readonly:hover {
  box-shadow: none;
}
.cell-slot {
  font-size: 12px;
  color: #97a1ad;
}
.cell-clock {
  font-weight: 700;
  font-size: 12px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-part {
  font-size: 13px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-empty {
  color: #c0c7cf;
  font-size: 12px;
  margin-top: 6px;
}
.actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
