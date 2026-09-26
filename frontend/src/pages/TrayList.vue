<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useTrayStore } from '../stores/trayStore';
import { TrayError, totalCells, type TrayDraft } from '../types/tray';

const router = useRouter();
const trayStore = useTrayStore();

const dialogVisible = ref(false);
const error = ref('');
const stateFilter = ref<'all' | 'open' | 'closed'>('all');

const form = reactive<TrayDraft>({
  trayNo: '',
  rows: 4,
  cols: 6,
  location: '',
  note: '',
});

const rows = computed(() =>
  trayStore.trays
    .filter((t) => stateFilter.value === 'all' || t.state === stateFilter.value)
    .sort((a, b) => b.createdAt - a.createdAt),
);

const openCount = computed(() => trayStore.trays.filter((t) => t.state === 'open').length);
const placedCount = computed(() => trayStore.placements.length);

function openDialog() {
  dialogVisible.value = true;
  error.value = '';
  form.trayNo = `TRAY-${String(trayStore.trays.length + 1).padStart(2, '0')}`;
}

function goDetail(row: { id: string }) {
  void router.push(`/trays/${row.id}`);
}

async function submit() {
  try {
    const tray = await trayStore.addTray({ ...form, location: form.location.trim(), note: form.note.trim() });
    dialogVisible.value = false;
    ElMessage.success(`托盘 ${tray.trayNo} 已建立`);
    void router.push(`/trays/${tray.id}`);
  } catch (e) {
    error.value = e instanceof TrayError ? e.message : '保存失败，请重试';
  }
}

onMounted(async () => {
  await trayStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>零件托盘</h2>
      <el-tag>在用 {{ openCount }} 盘</el-tag>
      <el-tag type="warning">在盘零件 {{ placedCount }} 件</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="openDialog">新建托盘</el-button>
    </div>

    <el-card shadow="never">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="状态">
          <el-select v-model="stateFilter" style="width: 140px">
            <el-option label="全部" value="all" />
            <el-option label="在用" value="open" />
            <el-option label="已关盘" value="closed" />
          </el-select>
        </el-form-item>
      </el-form>
      <el-table :data="rows" size="small" border @row-click="goDetail">
        <el-table-column prop="trayNo" label="托盘编号" width="130" />
        <el-table-column label="规格" width="110">
          <template #default="{ row }">{{ row.rows }}×{{ row.cols }}（{{ totalCells(row) }} 格）</template>
        </el-table-column>
        <el-table-column prop="location" label="存放位置" min-width="150" />
        <el-table-column label="占用" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="trayStore.occupancy(row.id) > 0 ? 'warning' : 'info'" effect="plain">
              {{ trayStore.occupancy(row.id) }} / {{ totalCells(row) }} 格
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.state === 'open' ? 'success' : 'info'">
              {{ row.state === 'open' ? '在用' : '已关盘' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="建立时间" width="170">
          <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</template>
        </el-table-column>
        <el-table-column label="关盘时间" width="170">
          <template #default="{ row }">{{ row.closedAt ? new Date(row.closedAt).toLocaleString('zh-CN') : '—' }}</template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
      </el-table>
      <el-empty v-if="rows.length === 0" description="暂无托盘，点击右上角新建" :image-size="60" />
    </el-card>

    <el-dialog v-model="dialogVisible" title="新建托盘" width="520px">
      <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form :model="form" label-width="90px">
        <el-form-item label="托盘编号" required>
          <el-input v-model="form.trayNo" placeholder="如 TRAY-A01" />
        </el-form-item>
        <el-form-item label="行数">
          <el-input-number v-model="form.rows" :min="1" :max="10" />
        </el-form-item>
        <el-form-item label="列数">
          <el-input-number v-model="form.cols" :min="1" :max="12" />
        </el-form-item>
        <el-form-item label="存放位置">
          <el-input v-model="form.location" placeholder="如 修复台 A-2 抽屉" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
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
:deep(.el-table__row) {
  cursor: pointer;
}
</style>
