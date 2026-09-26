<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { readDbVersion } from './utils/db';
import { useOperatorStore } from './stores/operatorStore';

const route = useRoute();
const router = useRouter();
const operatorStore = useOperatorStore();

const activeMenu = computed(() => {
  if (route.path.startsWith('/clocks')) return '/clocks';
  if (route.path.startsWith('/steps')) return '/steps/new';
  if (route.path.startsWith('/parts')) return '/parts';
  if (route.path.startsWith('/trays')) return '/trays';
  if (route.path.startsWith('/tests')) return '/tests';
  return '/clocks';
});

const version = readDbVersion();

const newOperatorVisible = ref(false);
const newOperatorName = ref('');

function openNewOperator() {
  newOperatorName.value = '';
  newOperatorVisible.value = true;
}
function submitNewOperator() {
  const name = newOperatorName.value.trim();
  if (!name) return;
  if (operatorStore.operators.includes(name)) {
    operatorStore.setCurrent(name);
  } else {
    operatorStore.addOperator(name);
    ElMessage.success(`已切换为操作人「${name}」`);
  }
  newOperatorVisible.value = false;
}

function onSelect(index: string) {
  if (index === '/tests') {
    void router.push('/tests/');
    return;
  }
  void router.push(index);
}
</script>

<template>
  <el-container class="app">
    <el-header class="app-header">
      <div class="brand">古钟表维修工序档案</div>
      <el-menu :default-active="activeMenu" mode="horizontal" class="menu" @select="onSelect">
        <el-menu-item index="/clocks">钟表台账</el-menu-item>
        <el-menu-item index="/steps/new">工序录入</el-menu-item>
        <el-menu-item index="/parts">零件清单</el-menu-item>
        <el-menu-item index="/trays">托盘追踪</el-menu-item>
        <el-menu-item index="/tests">走时测试</el-menu-item>
      </el-menu>
      <div class="operator">
        <span class="operator-label">当前操作人</span>
        <el-select
          :model-value="operatorStore.current"
          size="small"
          style="width: 130px"
          @change="(v: unknown) => operatorStore.setCurrent(String(v))"
        >
          <el-option v-for="op in operatorStore.operators" :key="op" :label="op" :value="op" />
          <template #footer>
            <el-button text size="small" style="width: 100%" @click="openNewOperator">+ 新增操作人</el-button>
          </template>
        </el-select>
      </div>
      <el-tag size="small" effect="plain">本地结构版本 v{{ version }}</el-tag>
    </el-header>
    <el-main class="app-main">
      <router-view />
    </el-main>

    <el-dialog v-model="newOperatorVisible" title="新增操作人" width="360px">
      <el-input
        v-model="newOperatorName"
        placeholder="输入姓名后回车"
        maxlength="20"
        @keyup.enter="submitNewOperator"
      />
      <template #footer>
        <el-button @click="newOperatorVisible = false">取消</el-button>
        <el-button type="primary" @click="submitNewOperator">保存并切换</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<style scoped>
.app {
  min-height: 100vh;
  background: #f6f8fa;
}
.app-header {
  display: flex;
  align-items: center;
  gap: 18px;
  background: #2f3a46;
  color: #f4f6f8;
  height: 60px;
}
.brand {
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
}
.menu {
  flex: 1;
  border-bottom: none;
  background: transparent;
}
:deep(.menu .el-menu-item) {
  color: #d6dde5;
}
:deep(.menu .el-menu-item.is-active) {
  color: #ffffff;
  border-bottom-color: #e7c56b;
}
.operator {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.operator-label {
  font-size: 12px;
  color: #b7c0cb;
}
:deep(.operator .el-select__wrapper) {
  background: #3a4756;
  box-shadow: 0 0 0 1px #4d5a69 inset;
}
:deep(.operator .el-select__placeholder),
:deep(.operator .el-select__selected-item) {
  color: #f4f6f8;
}
.app-main {
  padding: 18px 22px 40px;
}
</style>
