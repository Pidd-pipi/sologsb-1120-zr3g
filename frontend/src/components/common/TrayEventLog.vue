<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useTrayStore } from '../../stores/trayStore';
import { useClockStore } from '../../stores/clockStore';
import { usePartStore } from '../../stores/partStore';
import { TRAY_EVENT_LABELS, TRAY_EVENT_TONES, type TrayEvent } from '../../types/tray';
import { formatDateTime } from '../../utils/format';

const props = withDefaults(
  defineProps<{
    /** 限定某托盘的流水（含跨盘转出/转入） */
    trayId?: string;
    /** 限定某台钟表的流水 */
    clockId?: string;
    /** 详情页下隐藏钟表列 */
    hideClock?: boolean;
    /** 空态文案 */
    emptyText?: string;
    max?: number;
  }>(),
  { hideClock: false, emptyText: '暂无托盘流水' },
);

const trayStore = useTrayStore();
const clockStore = useClockStore();
const partStore = usePartStore();

onMounted(async () => {
  await trayStore.load();
  await clockStore.load();
  await partStore.load();
});

const rows = computed(() => {
  let list: TrayEvent[];
  if (props.trayId) list = trayStore.eventsByTray(props.trayId);
  else if (props.clockId) list = trayStore.eventsByClock(props.clockId);
  else list = [...trayStore.events].sort((a, b) => b.at - a.at);
  return props.max ? list.slice(0, props.max) : list;
});

function clockNo(id: string): string {
  return clockStore.byId(id)?.clockNo ?? '—';
}
function partLabel(id: string): string {
  if (!id) return '—';
  const p = partStore.items.find((it) => it.id === id);
  return p ? `${p.name}（${p.wearState}）` : '已删除零件';
}
function trayName(id: string): string {
  return trayStore.trayName(id);
}

/** 转格/换新的格位描述 */
function routeText(e: TrayEvent): string {
  if (e.type === 'move' && e.fromTrayId && e.toTrayId) {
    const sameTray = e.fromTrayId === e.toTrayId;
    const from = sameTray ? e.fromSlotCode : `${trayName(e.fromTrayId)} ${e.fromSlotCode}`;
    const to = sameTray ? e.toSlotCode : `${trayName(e.toTrayId)} ${e.toSlotCode}`;
    return `${from} → ${to}`;
  }
  if (e.type === 'replace') {
    const np = e.newPartId ? partStore.items.find((it) => it.id === e.newPartId) : undefined;
    return np ? `格位 ${e.slotCode} · 新件：${np.name}（批号 ${np.sourceLot || '无'}）` : `格位 ${e.slotCode}`;
  }
  if (e.type === 'put' || e.type === 'return') return `格位 ${e.slotCode ?? ''}`;
  return '';
}
</script>

<template>
  <el-table :data="rows" size="small" border>
    <el-table-column label="时间" width="170">
      <template #default="{ row }">{{ formatDateTime(row.at) }}</template>
    </el-table-column>
    <el-table-column label="事件" width="80">
      <template #default="{ row }">
        <el-tag size="small" :type="TRAY_EVENT_TONES[row.type as TrayEvent['type']]">
          {{ TRAY_EVENT_LABELS[row.type as TrayEvent['type']] }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column v-if="!hideClock" label="钟表" width="150">
      <template #default="{ row }">{{ clockNo(row.clockId) }}</template>
    </el-table-column>
    <el-table-column label="零件" width="150">
      <template #default="{ row }">{{ partLabel(row.partId) }}</template>
    </el-table-column>
    <el-table-column label="格位 / 去向" min-width="200">
      <template #default="{ row }">{{ routeText(row) }}</template>
    </el-table-column>
    <el-table-column prop="operator" label="操作人" width="100" />
    <el-table-column prop="note" label="备注" min-width="160" show-overflow-tooltip />
  </el-table>
  <el-empty v-if="rows.length === 0" :description="emptyText" :image-size="60" />
</template>
