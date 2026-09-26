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
        ├── stores/{clock,part,step,tray}Store.ts
        ├── components/common/{StepSequence,RateChart,ClockCard,StateBadge}.vue
        ├── hooks/{useClockSearch,useRepairProgress}.ts
        ├── pages/{ClockList,ClockDetail,StepForm,PartList,TrayList,TrayDetail,TestView}.vue
        └── utils/{db,timeCalc,id}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/clocks` | 钟表台账：按种类/机芯/品相/年代区间筛选，按修复状态分栏 | Clock |
| `/clocks/:id` | 钟表详情：左侧机芯信息，右侧工序流与走时测试记录，可切零件清单与托盘追踪 | Clock、RepairStep、TimekeepingTest、MovementPart、TrayPlacement、TrayEvent |
| `/steps/new` | 新建维修工序：选步骤类型后动态出清洗液/油脂/力矩字段，顺序号冲突即报错 | RepairStep、MovementPart |
| `/parts` | 零件与配换清单：按磨损状态分组，标出待修配条目与来源批号 | MovementPart |
| `/trays` | 托盘台账：占用格数、状态筛选，可新建托盘 | Tray、TrayPlacement |
| `/trays/:id` | 托盘详情：格位图点选操作，放入/转格/归还/换新，关盘与流水 | Tray、TrayPlacement、TrayEvent、MovementPart |
| `/tests/:clockId` | 走时测试录入与多方位均值计算，生成走时单文本 | TimekeepingTest |

`/` 重定向到 `/clocks`，未匹配路由同样兜底到 `/clocks`。

## 数据存储说明

- 数据库名 `gbclockrepair`，当前结构版本 **v3**（`localStorage['gbclockrepair:db-version']` 记录）。
- 七张表：`clocks`（钟表）、`parts`（机芯零件）、`steps`（维修工序）、`tests`（走时测试）、`trays`（零件托盘）、`placements`（当前在盘格位占用）、`trayEvents`（托盘操作流水）。
- v1 → v2 迁移：补齐老记录的 `state`、`partIds`、`torque`、`positions` 字段并新增索引。
- v2 → v3 迁移：仅新增托盘三张表，旧表结构不动，**老的零件等记录升级后原样保留**。
- `placements` 带两条唯一索引兜底硬约束：`&[trayId+cellNo]`（同一格位不并放两件）、`&partId`（同一零件不同时占两处）；store 层另在事务内先做中文友好校验。
- `trayEvents` 只增不删：放入 / 转格 / 归还 / 换新 / 关盘 / 重开都记录时间与操作人，零件丢失可倒查末次经手人。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 台示范钟表、3 项零件、3 道工序、1 次走时测试，以及 1 只 4×6 托盘（2 件在盘零件、3 条流水，含一次转格）。

## 功能要点

- **顺序号不跳号**：新建工序时若顺序号大于「当前最大顺序号 + 1」直接报错并给出建议值；`<StepSequence>` 对缺口行标红。
- **工序排序**：支持「上移 / 下移」按钮与原生拖拽交换顺序，交换的是 `seq`。
- **工序完成 / 回退**：完成后写 `finishedAt`，回退后计入待办与回退计数。
- **托盘格位追踪**：每台钟表的零件按格位（如 B3）登记入盘；放入、转格、归还、换新全部留下时间与操作人，操作人记忆在 `localStorage`。
- **双重唯一约束**：同一格位不能并放两件、同一零件不能同时占用两处，事务内校验 + IndexedDB 唯一索引双保险，冲突报出具体位置。
- **关盘检查**：关盘时若仍有未处理零件，弹窗逐格列出格位号、零件、所属钟表与末次经手人，清空后方可关盘；关盘后只读，可重开。
- **钟表详情看托盘**：详情页「托盘追踪」页签显示该钟表当前在盘的托盘/格位与历史流水，点击托盘编号直达托盘详情。
- **双轴走时图**：`<RateChart>` 左轴日差 s/d、右轴摆幅 °，标注四方位读数与均值。
- **走时单导出**：按方位均值生成文本，可复制或下载 txt。
