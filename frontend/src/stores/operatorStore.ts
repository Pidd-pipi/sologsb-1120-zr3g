import { defineStore } from 'pinia';

const LS_OPERATORS_KEY = 'gbclockrepair:operators';
const LS_CURRENT_OPERATOR_KEY = 'gbclockrepair:current-operator';

/** 默认经手人，与示范数据中的修复师一致 */
const DEFAULT_OPERATORS = ['祁仲言'];

function readOperators(): string[] {
  try {
    const raw = window.localStorage.getItem(LS_OPERATORS_KEY);
    if (raw) {
      const list = JSON.parse(raw) as string[];
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch {
    /* localStorage 不可用时走默认 */
  }
  return [...DEFAULT_OPERATORS];
}

function readCurrent(operators: string[]): string {
  try {
    const raw = window.localStorage.getItem(LS_CURRENT_OPERATOR_KEY);
    if (raw && operators.includes(raw)) return raw;
  } catch {
    /* 忽略 */
  }
  return operators[0];
}

interface OperatorState {
  operators: string[];
  current: string;
}

export const useOperatorStore = defineStore('operator', {
  state: (): OperatorState => {
    const operators = readOperators();
    return { operators, current: readCurrent(operators) };
  },
  actions: {
    persist() {
      try {
        window.localStorage.setItem(LS_OPERATORS_KEY, JSON.stringify(this.operators));
        window.localStorage.setItem(LS_CURRENT_OPERATOR_KEY, this.current);
      } catch {
        /* localStorage 不可用时仅保存在内存 */
      }
    },
    setCurrent(name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (!this.operators.includes(trimmed)) this.operators = [...this.operators, trimmed];
      this.current = trimmed;
      this.persist();
    },
    addOperator(name: string): boolean {
      const trimmed = name.trim();
      if (!trimmed) return false;
      if (this.operators.includes(trimmed)) return false;
      this.operators = [...this.operators, trimmed];
      this.current = trimmed;
      this.persist();
      return true;
    },
  },
});
