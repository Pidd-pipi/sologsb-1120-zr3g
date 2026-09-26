# sologsb-1120 古钟表维修工序档案（gbclockrepair）

面向钟表修复师的工序档案台：为一台古董钟表建档，记录机芯型号、零件缺失与配换、拆解顺序、清洗润滑点位，以及修复后的走时测试数据。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21820**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| UI | Element Plus 2 |
| 构建 | Vite 5 |
| 状态管理 | Pinia |
| 路由 | Vue Router 4（history 模式） |
| 本地存储 | IndexedDB（Dexie 4），含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # vue-tsc 类型检查 + vite 构建
npm run verify:tray       # 托盘追踪不变量验证（fake-indexeddb）
npm run verify:migration  # v2 → v3 数据迁移验证
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

## 目录结构

```
sologsb-1120/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.ts
        ├── App.vue
        ├── router/index.ts
        ├── types/{clock,part,step,test,tray}.ts
        ├── stores/{clock,part,step,tray,operator}Store.ts
        ├── components/common/{StepSequence,RateChart,ClockCard,StateBadge,TrayEventLog}.vue
        ├── hooks/{useClockSearch,useRepairProgress}.ts
        ├── pages/{ClockList,ClockDetail,StepForm,PartList,TrayBoard,TestView}.vue
        └── utils/{db,timeCalc,id,format}.ts
    └── scripts/{verify-tray,verify-migration}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/clocks` | 钟表台账：按种类/机芯/品相/年代区间筛选，按修复状态分栏 | Clock |
| `/clocks/:id` | 钟表详情：左侧机芯信息，右侧工序流、走时测试、零件清单、托盘追踪 | Clock、RepairStep、TimekeepingTest、MovementPart、Tray、SlotPlacement、TrayEvent |
| `/steps/new` | 新建维修工序：选步骤类型后动态出清洗液/油脂/力矩字段，顺序号冲突即报错 | RepairStep、MovementPart |
| `/parts` | 零件与配换清单：按磨损状态分组，标出待修配条目与来源批号 | MovementPart |
| `/trays` | 托盘追踪：格位图、放入/转格/归还/换新、关盘校验、托盘流水 | Tray、SlotPlacement、TrayEvent、MovementPart |
| `/tests/:clockId` | 走时测试录入与多方位均值计算，生成走时单文本 | TimekeepingTest |

`/` 重定向到 `/clocks`，未匹配路由同样兜底到 `/clocks`。

## 数据存储说明

- 数据库名 `gbclockrepair`，当前结构版本 **v3**（`localStorage['gbclockrepair:db-version']` 记录）。
- 七张表：`clocks`（钟表）、`parts`（机芯零件）、`steps`（维修工序）、`tests`（走时测试）、`trays`（托盘）、`placements`（格位当前占用）、`trayEvents`（托盘流水，只追加）。
- v1 → v2 迁移：补齐老记录的 `state`、`partIds`、`torque`、`positions` 字段并新增索引。
- v2 → v3 迁移：新增托盘三张表，旧表与旧记录一律不动；旧零件在换新后也不删除，仅以流水关联新件 id。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 台示范钟表、4 项零件（含一对换新前后的发条）、3 道工序、1 次走时测试、2 个托盘（1 开盘 / 1 关盘）与完整示范流水。

## 托盘追踪要点

- **登记口径**：每台钟表的零件按「托盘 + 格位码」（行字母 + 列号，如 B3）登记，格位数量在开盘时确定。
- **四种经手动作**：放入、转格（支持跨托盘）、归还（装回机芯）、换新（旧件出盘 + 新件登记入台账并入格）。每个动作都写一条不可改的流水，含时间戳与操作人；开盘、关盘同样入流水。
- **双重唯一占用**：`placements` 复合主键 `[trayId+slotCode]` 保证同一格位只放一件，唯一索引 `&partId` 保证同一零件不同时占两处；store 预检查之外，IndexedDB 约束本身兜底（`npm run verify:tray` 覆盖）。
- **关盘点名**：关盘时若还有未处理零件，拒绝关盘并逐条列出具体格位、所属钟表、零件、末次经手人与时间。
- **操作人**：顶栏选择当前操作人（localStorage 持久化，可新增），所有流水以此人记名。
- **钟表详情**：「托盘追踪」页签可看该钟当前散落在哪些托盘格位，以及含已关盘在内的全部历史流水。

## 功能要点

- **顺序号不跳号**：新建工序时若顺序号大于「当前最大顺序号 + 1」直接报错并给出建议值；`<StepSequence>` 对缺口行标红。
- **工序排序**：支持「上移 / 下移」按钮与原生拖拽交换顺序，交换的是 `seq`。
- **工序完成 / 回退**：完成后写 `finishedAt`，回退后计入待办与回退计数。
- **双轴走时图**：`<RateChart>` 左轴日差 s/d、右轴摆幅 °，标注四方位读数与均值。
- **走时单导出**：按方位均值生成文本，可复制或下载 txt。
- **托盘可追溯**：格位图按钟表着色；放入/转格/归还/换新均留时间与操作人；关盘拦截点名未处理格位；详情页可回溯本钟全部托盘记录。
