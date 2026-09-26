<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useTrayStore } from '../stores/trayStore';
import { useRepairProgress } from '../hooks/useRepairProgress';
import StepSequence from '../components/common/StepSequence.vue';
import RateChart from '../components/common/RateChart.vue';
import StateBadge from '../components/common/StateBadge.vue';
import { CONDITION_GRADES, type ConditionGrade } from '../types/clock';
import { judgeTest } from '../types/test';
import { TRAY_ACTION_LABELS, cellLabel, type TrayAction } from '../types/tray';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();
const trayStore = useTrayStore();

const clockId = computed(() => String(route.params.id ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const { progress, steps, done, total, percent, current, gaps } = useRepairProgress(clockId);
const parts = computed(() => partStore.byClock(clockId.value));
const tests = computed(() => stepStore.testsByClock(clockId.value));
const trayPlacements = computed(() => trayStore.placementsByClock(clockId.value));
const trayEvents = computed(() => trayStore.eventsByClock(clockId.value));
const activeTab = ref('steps');

function partName(id?: string): string {
  if (!id) return '—';
  return partStore.items.find((p) => p.id === id)?.name ?? '已删除零件';
}
function trayNoOf(id: string): string {
  return trayStore.byId(id)?.trayNo ?? '未知托盘';
}
function cellOf(trayId: string, cellNo?: number): string {
  if (cellNo === undefined) return '—';
  const t = trayStore.byId(trayId);
  return t ? cellLabel(cellNo, t.cols) : `#${cellNo}`;
}

async function finish(id: string) {
  await stepStore.finish(id);
  ElMessage.success('步骤已完成');
}
async function rollback(id: string) {
  await stepStore.rollback(id);
  ElMessage.warning('步骤已回退');
}
async function move(payload: { id: string; direction: 'up' | 'down' }) {
  const list = steps.value;
  const index = list.findIndex((it) => it.id === payload.id);
  const target = payload.direction === 'up' ? list[index - 1] : list[index + 1];
  if (!target) return;
  await stepStore.swapSeq(payload.id, target.id);
  ElMessage.success('顺序已调整');
}
async function reorder(payload: { fromId: string; toId: string }) {
  await stepStore.swapSeq(payload.fromId, payload.toId);
  ElMessage.success('已按拖拽交换顺序');
}
async function changeGrade(value: unknown) {
  const grade = String(value) as ConditionGrade;
  await clockStore.setGrade(clockId.value, grade);
  ElMessage.success(`品相等级已更新为「${grade}」`);
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await stepStore.load();
  await trayStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>钟表详情 · {{ clock?.clockNo ?? '未找到' }}</h2>
      <StateBadge v-if="clock" :grade="clock.conditionGrade" />
      <el-tag v-if="gaps.length" type="danger">顺序号缺口：{{ gaps.join('、') }}</el-tag>
      <el-tag v-else type="success" effect="plain">顺序号连续</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="router.push(`/steps/new?clockId=${clockId}`)">追加维修工序</el-button>
      <el-button @click="router.push(`/tests/${clockId}`)">走时测试录入</el-button>
      <el-button @click="router.push('/clocks')">返回台账</el-button>
    </div>

    <el-alert v-if="!clock" type="warning" :closable="false" title="未找到该钟表（可能已被删除）" show-icon />

    <div v-if="clock" class="grid">
      <el-card shadow="never">
        <template #header><strong>机芯信息</strong></template>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="藏品号">{{ clock.clockNo }}</el-descriptions-item>
          <el-descriptions-item label="种类">{{ clock.kind }}</el-descriptions-item>
          <el-descriptions-item label="机芯型号">{{ clock.caliber }}</el-descriptions-item>
          <el-descriptions-item label="国别 / 制作者">{{ clock.origin }} / {{ clock.maker }}</el-descriptions-item>
          <el-descriptions-item label="年代">{{ clock.yearMade }}</el-descriptions-item>
          <el-descriptions-item label="钟壳材质">{{ clock.caseMaterial }}</el-descriptions-item>
          <el-descriptions-item label="尺寸 mm">{{ clock.size }}</el-descriptions-item>
          <el-descriptions-item label="盘面标识">{{ clock.dialMark }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ clock.acquireFrom }}</el-descriptions-item>
          <el-descriptions-item label="存放位置">{{ clock.storagePos }}</el-descriptions-item>
          <el-descriptions-item label="零件条目">{{ parts.length }} 项</el-descriptions-item>
        </el-descriptions>
        <div class="grade-row">
          <span>品相等级：</span>
          <el-radio-group :model-value="clock.conditionGrade" size="small" @change="changeGrade">
            <el-radio-button v-for="g in CONDITION_GRADES" :key="g" :value="g">{{ g }}</el-radio-button>
          </el-radio-group>
        </div>
      </el-card>

      <div class="right">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>修复进度</strong>
              <el-tag size="small">{{ done }}/{{ total }} · {{ percent }}%</el-tag>
              <span v-if="current" class="muted">
                当前卡点：#{{ current.seq }} {{ current.stepType }}（{{ current.operator }}）
              </span>
              <span v-else class="muted">全部步骤已完成</span>
            </div>
          </template>
          <el-progress :percentage="percent" :stroke-width="12" />
          <el-tabs v-model="activeTab" style="margin-top: 12px">
            <el-tab-pane label="工序顺序" name="steps">
              <StepSequence
                :items="steps"
                sortable
                @finish="finish"
                @rollback="rollback"
                @move="move"
                @reorder="reorder"
              />
            </el-tab-pane>
            <el-tab-pane :label="`零件清单（${parts.length}）`" name="parts">
              <el-table :data="parts" size="small" border>
                <el-table-column prop="name" label="零件" width="110" />
                <el-table-column prop="position" label="装配位置" min-width="150" />
                <el-table-column prop="wearState" label="磨损" width="90" />
                <el-table-column prop="decision" label="处理" width="90" />
                <el-table-column prop="sourceLot" label="来源批号" width="120" />
                <el-table-column prop="dimension" label="尺寸 mm" width="100" />
              </el-table>
              <el-empty v-if="parts.length === 0" description="暂无零件登记" :image-size="60" />
            </el-tab-pane>
            <el-tab-pane :label="`托盘追踪（${trayPlacements.length}）`" name="trays">
              <div class="tray-section-title">当前在盘</div>
              <el-table :data="trayPlacements" size="small" border>
                <el-table-column label="托盘" width="130">
                  <template #default="{ row }">
                    <el-link type="primary" @click="router.push(`/trays/${row.trayId}`)">
                      {{ trayNoOf(row.trayId) }}
                    </el-link>
                  </template>
                </el-table-column>
                <el-table-column label="格位" width="90">
                  <template #default="{ row }">{{ cellOf(row.trayId, row.cellNo) }}</template>
                </el-table-column>
                <el-table-column label="零件" width="110">
                  <template #default="{ row }">{{ partName(row.partId) }}</template>
                </el-table-column>
                <el-table-column prop="operator" label="末次经手人" width="110" />
                <el-table-column label="末次入格时间" min-width="160">
                  <template #default="{ row }">{{ new Date(row.placedAt).toLocaleString('zh-CN') }}</template>
                </el-table-column>
              </el-table>
              <el-empty v-if="trayPlacements.length === 0" description="当前无零件在托盘内" :image-size="60" />
              <template v-if="trayEvents.length > 0">
                <div class="tray-section-title">托盘流水</div>
                <el-table :data="trayEvents" size="small" border>
                  <el-table-column label="时间" width="165">
                    <template #default="{ row }">{{ new Date(row.at).toLocaleString('zh-CN') }}</template>
                  </el-table-column>
                  <el-table-column label="操作" width="80">
                    <template #default="{ row }">
                      <el-tag size="small" effect="plain">{{ TRAY_ACTION_LABELS[row.action as TrayAction] }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="零件" min-width="140">
                    <template #default="{ row }">
                      <template v-if="row.action === 'replace'">
                        {{ partName(row.replacedPartId) }} → {{ partName(row.partId) }}
                      </template>
                      <template v-else>{{ partName(row.partId) }}</template>
                    </template>
                  </el-table-column>
                  <el-table-column label="托盘 / 格位" min-width="150">
                    <template #default="{ row }">
                      {{ trayNoOf(row.trayId) }}
                      <template v-if="row.cellNo !== undefined"> · {{ cellOf(row.trayId, row.cellNo) }}</template>
                    </template>
                  </el-table-column>
                  <el-table-column prop="operator" label="操作人" width="100" />
                </el-table>
              </template>
            </el-tab-pane>
            <el-tab-pane :label="`走时测试（${tests.length}）`" name="tests">
              <div v-for="t in tests" :key="t.id" class="test-block">
                <div class="card-head">
                  <strong>{{ new Date(t.testedAt).toLocaleString('zh-CN') }}</strong>
                  <el-tag size="small" type="success">{{ t.conclusion || judgeTest(t.rate, t.beatError, t.amplitude) }}</el-tag>
                  <span class="muted">日差 {{ t.rate }} s/d · 摆幅 {{ t.amplitude }}° · 偏振 {{ t.beatError }} ms</span>
                </div>
                <RateChart :readings="t.positions" />
              </div>
              <el-empty v-if="tests.length === 0" description="暂无走时测试记录" :image-size="60" />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>
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
.grid {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.right {
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
.grade-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.test-block {
  margin-bottom: 16px;
}
.tray-section-title {
  font-weight: 600;
  font-size: 13px;
  color: #4c5663;
  margin: 4px 0 8px;
}
.tray-section-title:not(:first-child) {
  margin-top: 16px;
}
</style>
