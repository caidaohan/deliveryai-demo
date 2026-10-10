---
spec_id: aa-checkout.technical-spec
title: 技术 Spec：AA 结账
status: finalized
template_id: technical-design
schema_version: 1
linked_spec: aa-checkout.spec
baseline_design: repos/caidaohan_deliveryai-demo/AGENTS.md
depends_on_designs: []
supersedes_designs: []
created_at: 2026-10-10
updated_at: 2026-10-10 (v2 revision)
supersedes_designs:
  - aa-checkout.technical-spec (v1, commit 73281f5)
revision_notes:
  - v2 修订原因：N4 commit e1cfea1 在 src/components/AaPayDialog.tsx 内维护了独立的 confirmCloseOpen state 与 AaPayCloseConfirmDialog 组件，但与 CheckoutView 内的拦截逻辑分散，导致 SPEC §3 REQ-007（P0 Dialog 关闭二次确认）业务侧 1 项 fail（详见 artifacts/自动化用例开发/caidaohan_deliveryai-demo@c31589d/content.json）。
  - v2 修订范围：明确 Dialog 关闭二次确认 Dialog 由 CheckoutView 集中持有（与「取消 AA」「退款」二次确认并列）；AaPayDialog 不持有任何内部 confirm 弹窗与 state；handleOpenChange 直接透传；落地时必须删除既有的 AaPayCloseConfirmDialog 组件。
  - v2 修订章节：§1.2 关键决策；§2.5.2 子单支付与并发守卫（含新增 §2.5.2a）；§6 测试要点；§5 风险；§10.1 TASK-FE-006 / 007。
  - v2 不修改范围：上游产品 Spec、reducer 数据模型、其余前端 / E2E 任务清单结构。
---

# Design: AA 结账（沸点火锅点单演示）

> Spec 回答 What/Why，本 Design 回答 How。标识符（REQ/API/FIELD/STATE/MIG/NFR/TASK-xxx）沿用 `artifacts/产品Spec设计/产品 Spec：AA 结账/spec.md` 的 REQ-001~REQ-013 并补充实现侧 TASK-001~TASK-0xx，不重新编号。
> 如果 Design 与 Spec 冲突，以 Spec 为准；如需调整 Spec 任何条目，先回到上游节点确认。
> 本设计不修改代码、不提交代码（属于「技术 Spec 设计」节点）；实施任务清单见 §10 与同级 docs/requirements/aa-checkout.task-breakdown.md。

---

# 1. 方案概述

在沸点火锅点单演示（`hdl-order-demo`）的现有 `CheckoutView` 内，沿用 `useReducer` 内存态 + Radix Dialog + Tailwind 类名 + i18next 双语同步，扩展出 AA（平摊）结账能力。在不破坏现有单笔 PAY 路径、不引入新依赖、不修改 `server/` 的前提下，新增：
- 数据：`AppState.aaSession`（可选会话）+ `AppState.aaRefundLogs[]`；金额一律以整数「分」累加。
- 行为：等额 / 按比例 / 自定义金额三种拆分；邀请卡 + Dialog 子单支付；超时与 DemoConsole 加速；按子单单退款与取消 AA。
- 视图：`CheckoutView` 顶部新增「AA 结账」入口 + 拆分面板 + 邀请卡列表 + 聚合进度；新建 `AaPayDialog.tsx` 承载子单支付 Dialog；`DemoConsole` 新增 AA 加速 / 重置 / 退款日志三块。

核心思路是把 AA 当作 CheckoutView 的一个「模式」分支：进入 AA 后，原「选择支付方式」卡片整片隐藏，AA 邀请卡 + 聚合进度为唯一支付路径；AA 全清（包括全部取消或部分退款）后再恢复单笔 PAY 路径。

## 1.1 影响范围

| 模块 / 层 | 文件或目录 | 改动说明 | 关联 REQ |
|-----------|------------|----------|----------|
| 接口（前端契约） | `src/types.ts` | 新增 `AaMode` / `AaSubOrderStatus` / `AaSession` / `AaSubOrder` / `AaRefundLog`；扩展 `AppState` 与 `AppAction`（AA_*） | REQ-001 / 006 / 007 / 008 / 009 / 010 / 011 / 012 |
| 服务逻辑 | `src/state/orderReducer.ts` | 新增 8 个 AA_* action + 拆分辅助函数 + 超时 reducer 入口；顶部 JSDoc 标注「AA 与订单履约阶段解耦」 | REQ-003 ~ REQ-012 |
| 金额工具 | `src/lib/utils.ts` | 新增 `moneyCents(yuan: number): number`（四舍五入到整数分）、`centsToYuan(cents: number): number`；`money(value)` 不动 | REQ-003 / 004 / 005 / 013 |
| 视图 / 组件 | `src/components/CheckoutView.tsx` | 顶部渲染 AA 入口；拆分面板；邀请卡列表；聚合视图；超时常驻；按子单单退款 / 取消入口 | REQ-001 ~ REQ-013 |
| 视图 / 组件 | `src/components/AaPayDialog.tsx`（新增） | 邀请卡点击后弹出的「以 {{name}} 身份支付」Dialog；二次确认关闭；并发守卫 | REQ-007 |
| 视图 / 组件 | `src/components/DemoConsole.tsx` | 新增 AA 面板：超时数值输入、「模拟全部超时」、「重置 AA」、「AA 退款日志（最近 20 条）」 | REQ-010 / 011 / 012 |
| 视图 / 组件 | `src/App.tsx` | 派发 AA_* action 的回调；保持 hash 路由 `#/checkout` 不变；不为 AA 引入新顶级视图 | REQ-001 / 008 |
| 倒计时 hook | `src/hooks/useCountdown.ts`（新增） | 1Hz 推进 pending 子单剩余秒数；订阅 `aaSession.subOrders`，在过期点驱动 `AA_EXPIRE_SUB_ORDER`；卸载清理 | REQ-006 / 011 |
| 文案 | `src/i18n.ts` | 新增 `checkout.aa_*` / `message.aa_*` / `console.aa_*` 文案键；zh/en 双语同步 | 全文 |
| E2E | `e2e/aa-checkout.spec.ts`（新增） | 三大拆分模式 + 主流程 + 超时 + 取消 + 退款 + 重置的最小矩阵 | §10 / 验收清单 |
| 文档 | `docs/requirements/aa-checkout.task-breakdown.md`（新增） | 拆分前端 / 后端 / E2E 三份任务清单 | §10 |
| 文档 | `repos/caidaohan_deliveryai-demo/AGENTS.md` | 在「目录结构」与「编码约定」同步 AA 相关约定（可选且必须走 Human In Loop 验收；本设计不强制落地） | — |
| 存储 / 数据库 | 无 | — | — |
| 外部依赖 | 无新增 npm 依赖 | — | — |
| 配置 | 无新增构建 / 部署配置 | — | — |

## 1.2 关键决策

仅记录真正影响实现方向的决策。

- 金额一律以整数「分」在 reducer 内累加 / 比较 / 拆分，UI 输入用元、`moneyCents` 一次性归一为分后再做差额校验；不沿用 `parseFloat` 之和（避免 `0.1+0.2 !== 0.3`）：选「整数分为主」，原因 = 精度风险是核心验收点，浮点补丁只能降低风险。
- AA 会话存在时原「选择支付方式」卡片整片隐藏，恢复单笔 PAY 路径的触发点 = `AA_CANCEL_ALL`（无任何 paid 子单时）/ `AA_RESET` / 全部 `refunded` + 无 `pending|paid`：选「整片隐藏而非置灰」，原因 = 单笔 PAY 与 AA 子单支付共用同一个 viewport 同时存在会形成金额倒挂（`payable` 来自整单减 30，AA 子单金额总和等于 `payable`，但若用户先点单笔 PAY 就会截胡 AA）。
- AA 超时定时器与 1Hz 倒计时刷新共用一个 `useEffect`，分别用 `setTimeout`（到点 dispatch `AA_EXPIRE_SUB_ORDER`）与 `setInterval`（每 1000ms 触发组件局部 `useState` 刷新以重渲染时间文案）；卸载 / AA 会话清空 / 子单 `status` 不再是 `pending` 三类清理路径：选「共用 effect」，原因 = 两类副作用的生命周期与 aaSession 绑定一致，拆分反而容易漏清理。
- DemoConsole 调整 `timeoutMs` 时不对已存在的 pending 子单重新计时（保持「剩余多少就多少」）；新进入 pending 的子单按当前 `aaSession.timeoutMs` 计时：选「不重新计时」，原因 = 与现实「合同上的到期时间不随运营调整」语义一致；E2E 可直接构造新子单后立即验证 timeoutMs 生效。
- 拆分面板的三种模式各自维护草稿输入（`ratioInputs` / `customInputs`），切换模式时不互相覆盖：选「模式独立缓存」，原因 = 用户来回切换是常见操作，避免输入丢失引致校验错误。
- 发起人主动「我先支付」按钮（I-03 默认纳入 v1）复用 `AaPayDialog` 内 `aa_pay_self` 文案按钮：选「复用 Dialog」，原因 = 唯一 Dialog 即可统一并发守卫与二次确认逻辑，不引入第二条 PAY 链路。
- **Dialog 关闭二次确认由 `CheckoutView` 集中持有，`AaPayDialog` 不在内部挂任何 confirm 弹窗（避免 Radix Dialog 嵌套 / aria-modal 行为异常）**：`AaPayDialog.handleOpenChange(next)` 直接 `onOpenChange(next)` 透传给父级，由父级判断 `!next && payDialogOpen` 时拦截并 `setCloseConfirmOpen(true)`：选「父级拦截、统一持有」，原因 = 二次确认是路由级交互，归属 `CheckoutView`（与「取消 AA」「退款」二次确认并列）可统一 `data-testid` 与文案键、避免嵌套 Dialog 带来的可访问性 / 遮罩层冲突；这是 N4 v1 设计未明确指定导致 `AaPayDialog` 内独立维护 `confirmCloseOpen` state 且不被消费回归的根因，本设计 v2 显式锁定该边界。

---

# 2. 实现设计

## 2.1 文件清单

| 文件路径 | 新增/修改 | 职责 |
|----------|-----------|------|
| `src/types.ts` | 修改 | 新增 `AaMode` / `AaSubOrderStatus` / `AaSession` / `AaSubOrder` / `AaRefundLog`；扩展 `AppState`（`aaSession?` / `aaRefundLogs: AaRefundLog[]`）；扩展 `AppAction`（8 个 `AA_*` action） |
| `src/state/orderReducer.ts` | 修改 | 新增 8 个 `AA_*` case + 拆分辅助（`splitEqual` / `splitByRatio` / `splitByCustom`）+ `CREATE_SESSION`/`PAY_SUB_ORDER`/`EXPIRE_SUB_ORDER`/`CANCEL_ALL`/`REFUND_SUB_ORDER`/`REISSUE_SUB_ORDER`/`SET_TIMEOUT`/`EXP_ALL`/`RESET`；顶部 JSDoc 注明「AA 与订单履约阶段解耦」 |
| `src/lib/utils.ts` | 修改 | 新增 `moneyCents(yuan: number)` 与 `centsToYuan(cents: number)`；`uid()` / `cn()` / `money()` 不动 |
| `src/hooks/useCountdown.ts` | 新增 | 订阅 pending 子单剩余毫秒的 hook；到点 dispatch 过期；返回剩余秒数（用于 UI 渲染 mm:ss） |
| `src/components/AaPayDialog.tsx` | 新增 | Radix Dialog 内含订单概况、本人子单金额、支付方式选项、「确认支付 ¥{{amount}}」与「放弃」；并发守卫；关闭二次确认 |
| `src/components/CheckoutView.tsx` | 修改 | 增加 AA 入口可见性判断、拆分面板、邀请卡列表、聚合视图、超时显示、取消 / 退款入口；旧单笔 PAY 路径完整保留 |
| `src/components/DemoConsole.tsx` | 修改 | 增加 AA 面板 + AA 退款日志面板；Props 新增 `aaSession` / `aaRefundLogs` + 5 个回调（`onAaSetTimeout` / `onAaExpireAll` / `onAaReset` / `onAaRefundSubOrder` / `onAaReissueSubOrder`） |
| `src/App.tsx` | 修改 | `dispatch` 透传 AA_* 与原有 action；hash 路由保持 `#/checkout` 不变；不为 AA 新增顶级视图 |
| `src/i18n.ts` | 修改 | 新增 zh/en 文案键，遵循「`checkout.aa_*` / `message.aa_*` / `console.aa_*`」命名约定 |
| `e2e/aa-checkout.spec.ts` | 新增 | 三大拆分模式 + 主流程 + 超时 + 取消 + 退款 + 重置的 E2E 矩阵 |

## 2.2 数据模型

不涉及服务端 / 持久化存储；前端内存态 `AppState` 扩展如下。

| 对象 | 字段 | 类型 | 说明 | 关联 FIELD |
|------|------|------|------|------------|
| `AaMode` | — | `'equal' \| 'ratio' \| 'custom'` | 拆分模式枚举 | REQ-002 / 004 |
| `AaSubOrderStatus` | — | `'pending' \| 'paid' \| 'expired' \| 'cancelled' \| 'refunded'` | 子单状态枚举（可辨识联合） | REQ-006 / 007 / 008 / 009 / 010 / 011 |
| `AaSubOrder` | `diner` | `string` | 参与人名（来自 `state.diners[index]`） | REQ-006 / 007 |
| | `amountCents` | `number`（整数分） | 该子单应付金额；Σ = `payableCents` 严格成立 | REQ-003 / 004 / 005 |
| | `status` | `AaSubOrderStatus` | 子单当前状态 | REQ-006~011 |
| | `paidAt?` | `string`（ISO） | `paid` 时打点 | REQ-007 |
| | `expiredAt?` | `string`（ISO） | `expired` 时打点 | REQ-011 |
| | `cancelledAt?` | `string`（ISO） | `cancelled` 时打点 | REQ-009 |
| | `refundedAt?` | `string`（ISO） | `refunded` 时打点 | REQ-010 |
| `AaSession` | `id` | `string` | `uid()` 生成 | REQ-006 |
| | `mode` | `AaMode` | 创建时即定型 | REQ-002 / 004 |
| | `ratioInputs?` | `Record<diner, number>` | `mode === 'ratio'` 时使用，整数百分比 [0,100]，Σ === 100 | REQ-004 |
| | `customInputs?` | `Record<diner, number>` | `mode === 'custom'` 时使用，元（精度 0.01，≥ 0.01），Σ === `payableCents / 100` | REQ-005 |
| | `subOrders` | `AaSubOrder[]` | 创建时即按 diners 顺序生成 | REQ-006 |
| | `timeoutMs` | `number` | 默认 `1_800_000`；DemoConsole 可在 `[30_000, 1_800_000]` 调整 | REQ-011 / 012 |
| | `createdAt` | `string`（ISO） | 创建时间 | REQ-006 |
| | `allPaid` | `boolean`（派生） | 计算属性 = 所有子单 `status === 'paid'` | REQ-008 |
| `AaRefundLog` | `id` / `sessionId` / `diner` / `amountCents` | `string` / `string` / `string` / `number` | 与 `CancelLog` 类似字段命名 | REQ-010 |
| | `reason` | `'aa_cancel' \| 'aa_other'` | 当前仅发起人主动退款 | REQ-010 |
| | `note?` | `string` | 可选 | REQ-010 |
| | `requestedBy` | `'customer'` | 发起人即客户 | REQ-010 |
| | `requestedAt` / `decisionAt` | `string`（ISO） | 与 CancelLog 同语义 | REQ-010 |
| | `status` | `'approved'` | 本期直接生效，不引入审批 | REQ-010 |
| `AppState` | `+ aaSession?` | `AaSession \| undefined` | 创建时存在，全部完成 / 取消 / 重置后置为 `undefined`（不删除键以兼容旧反序列化降级） | REQ-001 / 008 / 009 / 012 |
| | `+ aaRefundLogs` | `AaRefundLog[]` | 默认 `[]` | REQ-010 / 012 |
| `AppAction` | `+ AA_CREATE_SESSION` | `{ diners: string[]; mode: AaMode; payableCents: number; timeoutMs: number; ratioInputs?: Record<string, number>; customInputs?: Record<string, number> }` | 创建会话时一次性写入金额与参与人列表 | REQ-002 / 003 / 004 / 005 |
| | `+ AA_PAY_SUB_ORDER` | `{ sessionId: string; diner: string }` | 子单支付；reducer 内做并发守卫 | REQ-007 |
| | `+ AA_EXPIRE_SUB_ORDER` | `{ sessionId: string; diner: string }` | 由 hook / DemoConsole 触发 | REQ-011 / 012 |
| | `+ AA_CANCEL_ALL` | `{ sessionId: string }` | 全部 pending/expired 子单 cancelled，保留 paid | REQ-009 |
| | `+ AA_REFUND_SUB_ORDER` | `{ sessionId: string; diner: string; note?: string }` | 已 paid → refunded；append `aaRefundLog` | REQ-010 |
| | `+ AA_REISSUE_SUB_ORDER` | `{ sessionId: string; diner: string }` | expired → pending，重置到期时间戳 | REQ-011 |
| | `+ AA_SET_TIMEOUT` | `{ sessionId: string; timeoutMs: number }` | DemoConsole 数值输入回写 | REQ-011 / 012 |
| | `+ AA_EXPIRE_ALL` | `{ sessionId: string }` | 一次性把所有 pending 置 expired（DemoConsole） | REQ-012 |
| | `+ AA_RESET` | `{ sessionId?: string }` | 清空 `aaSession` / `aaRefundLogs`，保留 `state.diners` / `state.orderItems` / `state.paid === false` | REQ-012 |

> 兼容策略：`AppState` 增量字段（`aaSession` / `aaRefundLogs`）缺失时按「`aaSession = undefined`、`aaRefundLogs = []`」降级；`initialState` 显式给出这两个字段（即使为空）以便 reducer 内可直接 `state.aaSession?.subOrders` 链式访问而无需可选链。

## 2.3 数据库变更

无服务端 / 数据库变更（仓库为纯前端内存态应用）。

## 2.4 接口变更

不涉及后端 API 变更；以下为前端内部契约（reducer dispatch 形状）。

| 接口（reducer action） | 类型 | 请求变化 | 响应变化 | 兼容性 |
|------------------------|------|----------|----------|--------|
| `AA_CREATE_SESSION` | 新增 | `{ diners, mode, payableCents, timeoutMs, ratioInputs?, customInputs? }` | reducer 写入新 `aaSession` 与子单列表 | 仅新增；旧代码 dispatch 不会命中 |
| `AA_PAY_SUB_ORDER` | 新增 | `{ sessionId, diner }` | reducer 将对应子单 `status: 'pending' → 'paid'`，聚合 N/M +1；并发守卫：非 pending 状态直接拒绝 | 仅新增 |
| `AA_EXPIRE_SUB_ORDER` | 新增 | `{ sessionId, diner }` | reducer 将对应子单置 `expired` | 仅新增 |
| `AA_CANCEL_ALL` | 新增 | `{ sessionId }` | reducer 把 pending/expired → cancelled；保留 paid；如无 paid 且无 pending/paid 则把 `aaSession = undefined`（回到单笔 PAY 路径） | 仅新增 |
| `AA_REFUND_SUB_ORDER` | 新增 | `{ sessionId, diner, note? }` | reducer 将对应 paid 子单置 `refunded`，append `aaRefundLog` | 仅新增 |
| `AA_REISSUE_SUB_ORDER` | 新增 | `{ sessionId, diner }` | reducer 将对应 expired 子单置 `pending`，重置到期时间戳 | 仅新增 |
| `AA_SET_TIMEOUT` | 新增 | `{ sessionId, timeoutMs }` | reducer 回写 `aaSession.timeoutMs`，已存在 pending 不重新计时 | 仅新增 |
| `AA_EXPIRE_ALL` | 新增 | `{ sessionId }` | 一次性把全部 pending 置 `expired` | 仅新增 |
| `AA_RESET` | 新增 | `{ sessionId? }` | 清空 `aaSession` / `aaRefundLogs`，`paid = false`；若 sessionId 与当前 `aaSession.id` 不匹配则拒绝（避免误清） | 仅新增 |

## 2.5 核心流程

### 2.5.1 入口创建与拆分面板

1. 用户在 CheckoutView 看到原「核对本桌账单」+「选择支付方式」结构；新加 AA 入口按钮（chili 500）。
2. 点击 AA 入口 → reducer dispatch `AA_CREATE_SESSION`；reducer 根据当前 mode（默认 equal）调用对应拆分函数生成 `subOrders`；写入 `aaSession`，原「选择支付方式」卡片卸载。
3. 拆分面板维持「等额 / 按比例 / 自定义金额」三选一 Tab；切换模式时 reducer 不实际写入（组件本地 useState 缓存），仅在「确认拆分并邀请」点击时 dispatch。
4. 三种模式计算：
   - 等额：`base = floor(payableCents / n)`，`remainder = payableCents - base * n`；前 `remainder` 位各 +1 分，保证 Σ = `payableCents`。
   - 按比例：以 `payableCents` × 比例 / 100 取整，最后一位补齐差额（与等额同款兜底）。
   - 自定义：把每位元输入 `moneyCents(xuan)` 转分、累加、差值校验；差值为 0 才允许 dispatch。

### 2.5.2 子单支付与并发守卫

1. 发起人点击邀请卡 → 打开 `AaPayDialog`；参数 = `{ session, diner, amountCents, items, onPay, onAbandon, open, onOpenChange }`。
2. Dialog 显示订单概况（菜品列表 + 子单聚合）、本人子单金额、支付方式选项；底部「确认支付」触发 `AA_PAY_SUB_ORDER`。
3. reducer 守卫：
   - `state.aaSession?.id !== sessionId` → 直接 `SET_MESSAGE(aa_invalid_session)` 并 return；
   - 找不到子单 → return；
   - 子单 `status !== 'pending'` → `SET_MESSAGE(aa_already_paid)`，不修改其他字段；
   - 否则 `status = 'paid'` 并打 `paidAt`；`allPaid` 派生；`state.paid` 仅在 `allPaid && aaSession` 仍存在时设为 `true`。
4. UI 层并行守卫（`AaPayDialog`）：`onPay` 点击时若子单 `status !== 'pending'`，组件仍调用 `onPay()`（透传给 reducer 守卫）并不修改 `onOpenChange`；reducer 内的守卫是最终边界。

### 2.5.2a Dialog 关闭二次确认（设计边界与实现约束）

**目的**：用户点击邀请卡打开支付 Dialog 后，点击关闭按钮 / Esc / 遮罩，都必须经过二次确认才允许真正关闭 —— 这是 SPEC §3 REQ-007 的 P0 验收点。

**关键设计边界**：

- 二次确认 Dialog 由父级 `CheckoutView` **集中持有**（与「取消 AA」/「退款」二次确认并列），状态名沿用 `closeConfirmOpen`。
- `AaPayDialog` **不**自己持有 confirm 弹窗，也不内嵌任何 Radix Dialog —— 若在 AaPayDialog 内部再渲染 `<Dialog open={...}>`，会在同一 `aria-modal` 容器下出现嵌套 Dialog，违背 Radix 设计且会让遮罩 / Esc 行为不可预期。
- 渲染上 `AaPayDialog` 仅渲染「主支付 Dialog」；**关闭拦截**通过 `onOpenChange(false)` 透传到父级 `CheckoutView` 完成。

**实现契约**：

`AaPayDialog` 的 `handleOpenChange` 形如（不持有内部二次确认状态）：

```ts
const handleOpenChange = (next: boolean) => {
  onOpenChange(next) // 直接透传给父级 CheckoutView
}
```

`CheckoutView` 的 `handlePayDialogOpenChange` 拦截并弹出二次确认：

```ts
const handlePayDialogOpenChange = (next: boolean) => {
  if (!next && payDialogOpen) {
    setCloseConfirmOpen(true) // 拦截：仅弹二次确认，不真正关闭
    return
  }
  setPayDialogOpen(next)
  if (!next) setPayDialogDiner(null)
}
```

二次确认 Dialog（位于 `CheckoutView`，与取消 AA / 退款二次确认并列）的按钮契约：

- 「放弃支付」按钮 (`data-testid="aa-dialog-close-confirm"`)：`setPayDialogOpen(false) + setPayDialogDiner(null) + setCloseConfirmOpen(false)`，此时才真正关闭主支付 Dialog。
- 「返回 / 继续支付」按钮（无 `data-testid`，或 `data-testid="aa-dialog-close-back"`）：仅 `setCloseConfirmOpen(false)`，主支付 Dialog 保持打开。

文案键：`checkout.aa_dialog_close_confirm` + `checkout.aa_pay_abandon` + `common.back`。

**测试透传**：

- 主支付 Dialog 打开后通过遮罩 / Esc / 关闭按钮尝试关闭 → 二次确认 Dialog 必须出现。
- 选择「返回 / 继续支付」→ 二次确认 Dialog 关闭，主支付 Dialog 仍打开。
- 选择「放弃支付」→ 二次确认 Dialog 与主支付 Dialog 都关闭，子单状态不变更（`aa_already_paid` 不应触发，因为这是单纯的「放弃」，不是「重复支付」）。
- reducer 不参与此条路径 —— 二次确认只是 UI 层交互，全部状态由 UI 关闭 / 重置，不调用任何 `AA_*` reducer action。

> 注：早期 v1 设计曾在 `AaPayDialog` 内预留一个独立的 `AaPayCloseConfirmDialog` 组件与内部 `confirmCloseOpen` state；该组件 / 状态在本设计 v2 中**显式作废**，落地时必须删除（包括 `src/components/AaPayDialog.tsx` 中的导出与任何 import 该组件的代码）。CheckoutView 才是关闭二次确认的唯一入口。

### 2.5.3 超时与重发

1. `useCountdown` 订阅 `state.aaSession?.subOrders`（仅 pending）；对每个 pending 子单计算「到期时间戳 = createdAt + timeoutMs」；用 `setTimeout` 在该时间点 dispatch `AA_EXPIRE_SUB_ORDER`；同时 1Hz `setInterval` 触发组件局部刷新以渲染 mm:ss。
2. 卸载 / AA 会话清空 / 子单转为非 pending → 通过 cleanup 清理两类定时器，避免内存泄漏 / 重复到点。
3. `AA_REISSUE_SUB_ORDER` 在 reducer 内把 `expiredAt` 清掉、`cancelledAt` 不变、返回 `pending`；到点时间重算（按「现在 + timeoutMs」）— 这是与「不重计时已存在 pending」的不同点：reset 后相当于「新建 pending」。

### 2.5.4 取消 AA

1. 发起人点击「取消 AA」→ 二次确认 Dialog（复用现有 `Dialog` / `DialogContent`） → dispatch `AA_CANCEL_ALL`。
2. reducer 把所有 `pending` / `expired` 子单 → `cancelled`；`paid` 子单保持 `paid`；如 `paid` 子单清单为空，则把 `aaSession = undefined`、`paid = false`，回到原单笔 PAY 路径。

### 2.5.5 按子单单退款

1. 发起人对任一 `paid` 子单点击「为 {{name}} 退款」→ 二次确认 Dialog → dispatch `AA_REFUND_SUB_ORDER`。
2. reducer 将该子单 → `refunded`，打 `refundedAt`，append `aaRefundLog`（`reason: 'aa_other'`、直接 `status: 'approved'`）；`allPaid` 重新判定（变 false），`state.paid` 同步回到 `false`，回到 AA 视图（聚合进度显示「1 已退款」+ 剩余 N/M）。

### 2.5.6 DemoConsole 加速与重置

1. AA 面板：数值输入 `[30_000, 1_800_000]`（含两端），回车或失焦时 dispatch `AA_SET_TIMEOUT`；同步更新 UI label「{{n}} 分钟 / {{n}} 秒」。
2. 「模拟全部超时」按钮（仅在 `aaSession` 存在且仍有 `pending` 子单时显示）→ dispatch `AA_EXPIRE_ALL`。
3. 「重置 AA」按钮 → 二次确认 Dialog → dispatch `AA_RESET`（sessionId 必须匹配当前 `aaSession.id`）；清空会话与日志，回到单笔 PAY 面板；保留 `state.diners` / `state.orderItems` / `state.paid === false`。

## 2.6 状态变化

| 操作 | 前置状态 | 目标状态 | 说明 |
|------|----------|----------|------|
| 进入 AA（点入口） | `aaSession === undefined` 且可见性条件成立 | `aaSession` 创建，N 个 pending 子单 | 原「选择支付方式」整片隐藏 |
| 子单支付 | 该子单 `status === 'pending'` | 该子单 `status === 'paid'` | 聚合 N/M +1；全部 paid 时主单 `paid = true` |
| 子单过期 | 该子单 `status === 'pending'` 且 `timeoutMs` 到点 | 该子单 `status === 'expired'` | 触发 `AA_EXPIRE_SUB_ORDER`（reducer 单点守卫） |
| 重发过期子单 | 该子单 `status === 'expired'` | 该子单 `status === 'pending'`，到期时间戳重算 | 触发 `AA_REISSUE_SUB_ORDER` |
| 取消 AA | `aaSession` 存在且尚有 `pending` / `expired` 子单 | 全部 `pending` / `expired` → `cancelled`；保留 paid；若 paid 也为空则 `aaSession = undefined`、`paid = false` | 触发 `AA_CANCEL_ALL` |
| 子单单退款 | 该子单 `status === 'paid'` | 该子单 `status === 'refunded'`，append `aaRefundLog` | 触发 `AA_REFUND_SUB_ORDER`；主单 `paid` 重新判定 |
| 调整超时 | `aaSession` 存在 | `aaSession.timeoutMs` 写入 | 不重计时已存在 pending |
| 全部超时 | `aaSession` 存在且有 pending | 全部 pending → expired | 触发 `AA_EXPIRE_ALL` |
| 重置 AA | `aaSession` 存在 | `aaSession = undefined`，`aaRefundLogs = []`，`paid = false` | 触发 `AA_RESET`；保留其他状态 |

## 2.7 异步处理

不涉及服务端异步调用；以下为客户端 timer / 副作用。

| 任务 / 事件 | 触发时机 | 处理逻辑 | 失败处理 |
|-------------|----------|----------|----------|
| 子单超时 | pending 子单到期时间戳 | `useCountdown` 内的 `setTimeout` 到点 → dispatch `AA_EXPIRE_SUB_ORDER` | 不存在 → 直接忽略（卸载或会话清空已 cleanup） |
| 倒计时 UI 刷新 | `useCountdown` 内 1Hz | `setInterval` 每 1000ms 触发 `useState(n => n+1)`；memo 计算 mm:ss | 卸载时 `clearInterval` |
| Session 清理 | `aaSession = undefined` 或所有子单已 `cancelled + refunded + paid` 时 `useEffect` 触发 | `useCountdown` cleanup 所有定时器 | 无 |
| 二次确认 Dialog | 用户尝试关闭 `AaPayDialog` 或取消 AA / 重置 AA | Radix `onOpenChange(false)` 拦截 → 展开二次确认 | 用户取消时保留 Dialog |

## 2.8 外部依赖

不引入新 npm 依赖；沿用 React 18 / TS / Vite / Tailwind / Radix Dialog / lucide-react / react-i18next / class-variance-authority / clsx / tailwind-merge。

| 依赖 | 用途 | 超时 / 重试 | 降级策略 |
|------|------|-------------|----------|
| 无新增 | — | — | — |

## 2.9 配置

不涉及新增配置项。

| 配置项 | 默认值 | 用途 | 生效范围 |
|--------|--------|------|----------|
| AA 默认 `timeoutMs`（应用内常量） | `1_800_000`（30min） | DemoConsole 不调整时的默认值 | 全局 |
| DemoConsole 数值输入范围 | `[30_000, 1_800_000]` | E2E 可触发「30s 即过期」 | DemoConsole 数值输入框 |
| 等额拆分最小参与人数 | `2` | 与可见性条件保持一致 | `CheckoutView` AA 入口 |
| 自定义金额最小值 | `0.01` 元（= 1 分） | 输入校验 / reducer 守卫 | 拆分面板 / reducer |

---

# 3. 兼容性与迁移

| 影响对象 | 兼容策略 | 迁移步骤 |
|----------|----------|----------|
| `AppState` 缺失 `aaSession` / `aaRefundLogs` | `initialState` 显式给出 `aaSession: undefined, aaRefundLogs: []`；reducer 写法一律用 `state.aaSession?.subOrders` 等可选链；不引入「`as any`」类兜底 | 无需迁移；如未来引入持久化（例如 localStorage 备份）需在反序列化时显式写回默认值 |
| 旧 E2E（`super-spicy.spec.ts` / `view-routing.spec.ts` / `return-dish.spec.ts`） | CheckoutView 改动仅追加（AA 入口在「选择支付方式」上方）；单笔 PAY 路径完整保留；hash 路由 `#/checkout` 不变；旧断言不变 | 无迁移；E2E 矩阵覆盖「保留单笔 PAY」（见 §10） |
| `cancelLogs` 退菜链路 | 完全不动；AA 退款走独立的 `aaRefundLogs`，与 `cancelLogs` 并列 | 无迁移 |
| ¥30 满减券策略 | 沿用「`subtotal >= 100 ? 30 : 0`」先减再拆分；不在 AA 子单文案叠加「-¥30」 | 无迁移 |
| `view-routing` 的 `ROUTE-*` 用例 | 不引入新顶级视图；AA 仍位于 `#/checkout`，通过 Radix Dialog 呈现 | 无迁移 |
| 现有 `paid: boolean` 字段语义 | 保持布尔：全部子单 `paid` 时 `paid = true`；任一 `refunded` / 取消全部回到 `false`；与单笔 PAY 同字段复用 | 无迁移 |

---

# 4. 上线与回滚

| 步骤 | 动作 | 备注 |
|------|------|------|
| 1 | 合并并发布代码（合并 `feat/aa-checkout-6z90` 至 `main`，触发 GitHub Pages 部署 workflow） | 沿用 `docs/agent-release.md` 流程 |
| 2 | 执行必要的数据或配置变更：无 | 内存态应用，无需 DDL / 配置 |
| 3 | 观察核心指标和日志：观察旧 E2E 是否仍绿、新 E2E `aa-checkout.spec.ts` 是否全过；`npm run build` / `npm run lint` / `npx tsc -b --noEmit` 三连通过 | 报告收口在 E2E 报告与 CI |

**回滚预案**：本期为仅前端纯内存态改动；回滚 = `git revert` 该提交，GH Pages 重新部署即可；本地刷新浏览器即可恢复到无 AA 状态（因为 `AppState.aaSession` 仅存在于内存）。回滚不涉及数据迁移或第三方调用。无需保留数据兼容垫层。

---

# 5. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 并发点击「确认支付」可能绕过 reducer 守卫 | React 18 严格模式下 useReducer dispatch 在 dev 环境会被双重调用；如守卫失守会出现重复扣款 | reducer 内对 `(sessionId, diner)` 维度的 `status === 'pending'` 做严格守卫（非 pending 立即 return）；在 `AAPayDialog` 内加 `disabled` 仅作 UI 优化；E2E `AA-边界-并发防重` 断言重复点击不触发新 `aaRefundLog` / 不修改 `paid` |
| 浮点累加误差（`0.1 + 0.2 !== 0.3`） | 等额 / 比例 / 自定义拆分的 Σ !== payable | 所有金额在 reducer 与拆分函数内一律用整数「分」；UI 输入框用 `parseFloat → moneyCents → cents`；E2E 断言以「整数分」比较 |
| timer 泄漏 | 视图切换 / AA 会话清空后 setTimeout 仍触发过期 | `useCountdown` 用 `useEffect` cleanup；reducer 守卫对非 pending 子单 return；E2E 验证「reset 后再创建不会被上一次 timer 标记 expired」 |
| `AA_RESET` 误清（dispatch 时 sessionId 与当前不匹配） | 误清一个会话后引发视图异常 | reducer 入口守卫：`action.sessionId === state.aaSession?.id` 才执行；否则 `SET_MESSAGE` + return |
| 拆分校验失败时用户切换模式误删草稿 | 用户来回切换模式时输入丢失 | 拆分面板本地 `useState` 按 mode 分别缓存草稿，切换 mode 不覆盖 |
| 超时数值输入无上界 / 下界保护 | 极端值（如 0 / 极大值）导致 timer 行为异常 | DemoConsole 数值输入 `min=30_000 max=1_800_000`；`AA_SET_TIMEOUT` reducer 入口再次校验范围，越界则 `SET_MESSAGE` + return |
| React 18 dev 双调用下 reducer 副作用被双触发 | 仅 dev 模式影响；生产无影响；但 E2E 双调用可能导致「第一次 dispatch 成功 → 第二次被守卫拦截」无生产 bug 但 E2E 报错 | 所有 reducer 副作用都是「幂等且守卫」，容忍双调用 |
| i18n 文案键缺失 / 拼写错误 | zh 渲染 en 文案或显示 key | 在 `useTranslation` t 函数返回 key 时回退到 `zh`；E2E 关键字串文案存在性自检（grep 类型）作为轻量自检；不在 E2E 主流程中断言 |
| 过期子单 reissue 后倒计时漂移 | reissue 触发 `AA_REISSUE_SUB_ORDER` 后「到期时间戳」未重算 | reducer 内统一以 `Date.now() + aaSession.timeoutMs` 写入内存计算的 `expiry`（不持久化为 ISO）；仅在 `useCountdown` 内按 (now + timeoutMs) 推算即可避免持久化漂移 |
| Dialog 关闭二次确认路由错位（N4 v1 已发生） | `AaPayDialog` 内部独立维护 `confirmCloseOpen` state 且不被消费，导致用户关闭主支付 Dialog 时二次确认 Dialog 不弹出，违反 SPEC §3 REQ-007 P0 验收 | 设计 v2 §2.5.2a 明确：二次确认 Dialog **由 CheckoutView 集中持有**；`AaPayDialog.handleOpenChange(next)` 直接 `onOpenChange(next)` 透传给父级，父级判断 `!next && payDialogOpen` 时 `setCloseConfirmOpen(true)` 拦截；落地必须删除 `AaPayDialog.tsx` 中既有的 `confirmCloseOpen` state 与 `AaPayCloseConfirmDialog` 导出；E2E `AA-Dialog-关闭-二次确认` 用例断言二次确认 Dialog 真实出现 |

---

# 6. 测试要点

E2E 单测覆盖矩阵（详见同级 `e2e/aa-checkout.spec.ts` 与 `docs/requirements/aa-checkout.task-breakdown.md` 的 TASK 列表）。

| 场景 | 方法 | 关联 REQ |
|------|------|----------|
| 等额拆分 Σ 严格相等 | Playwright：构造菜品使 subtotal ≥ 100、3 人 diners，发起 AA 等额，断言邀请卡金额依次为 `¥33.34 / ¥33.33 / ¥33.33`，Σ = 100.00 | REQ-003 |
| 按比例拆分（50/30/20 → 60.00/36.00/24.00） | Playwright：构造菜品使 subtotal ≥ 100、3 人 diners，输入比例，断言 | REQ-004 |
| 按比例拆分 Σ ≠ 100 确认按钮置灰 | Playwright：把比例调成 50/30/19，确认按钮 `disabled` | REQ-004 |
| 自定义金额 Σ 严格相等才放行 | Playwright：填入 Σ = 99.99，确认；改一位使 Σ = 99.98，确认按钮 disabled | REQ-005 |
| AA 入口可见性（diners.length < 2 / payable === 0） | Playwright：构造 `diners.length < 2` 与空 orderItems 场景，断言「AA 结账」按钮置灰 + tooltip | REQ-001 |
| 子单支付 + 主单聚合 | Playwright：依次点击两个邀请卡 → 完成支付 → 聚合视图显示「已支付 2/3」；最后一人支付 → 主单 `paid = true` 渲染成功页 + 「AA 已结清」附注 | REQ-007 / REQ-008 |
| 并发防重 | Playwright：先完成一次支付，再次打开 Dialog 点「确认支付」→ 断言 `aa_already_paid` 文案 + 不新增 `aaRefundLog` | REQ-007 |
| 超时子单自动 expired | Playwright：DemoConsole 调 `timeoutMs = 30_000`，构造菜品 → 发起 AA → 等 31s → 断言子单 `expired` + 聚合视图「X 个子单已超时」 | REQ-011 |
| 重新发起 expired 子单 | Playwright：在上一场景基础上点「重新发起」→ 子单回到 `pending`，倒计时显示 mm:ss | REQ-011 |
| 取消 AA | Playwright：2 子单 pending 状态下点「取消 AA」→ 二次确认 → 全部 `cancelled`，已支付子单保持 `paid`，回到单笔 PAY 路径 | REQ-009 |
| 按子单单退款 | Playwright：1 子单 paid 后点「为 {{name}} 退款」→ 二次确认 → 子单 `refunded`，DemoConsole AA 退款日志新增一条 | REQ-010 |
| DemoConsole 重置 AA | Playwright：发起 AA → 等子单 paid 后点「重置 AA」→ 二次确认 → `aaSession = undefined`，回到单笔 PAY | REQ-012 |
| 优惠与精度（满 100 减 30） | Playwright：菜品 subtotal ≥ 100，AA 拆分针对 payable（已减 30）；邀请卡金额文案不含「券」字；聚合视图保留「本单已使用 ¥30 会员菜品券」 | REQ-013 |
| 旧 E2E 不退化 | Playwright：同时跑 `super-spicy.spec.ts` / `view-routing.spec.ts` / `return-dish.spec.ts` 三套，全绿 | 兼容性 |
| Lint / 构建 / 类型 | `npm run lint` / `npm run build` / `npx tsc -b --noEmit` | 质量门 |
| Dialog 关闭二次确认 | Playwright：打开 AaPayDialog → 点遮罩关闭（Esc 同理）→ 二次确认 Dialog 出现且带 `aa-dialog-close-confirm` 按钮（位于 CheckoutView 内，**不是** AaPayDialog 内）；点「返回 / 继续支付」→ 主 Dialog 仍打开；点「放弃支付」→ 主 Dialog 与二次确认都关闭、aaSession 不变 | REQ-007 |

> 全部 E2E 不得使用 `sleep` / `waitForTimeout` 固定等待；超时等待一律使用 Playwright auto-retrying locator（参考 `docs/agent-testing.md` §2）。`timeoutMs = 30_000` 的真实 30s 等待是唯一例外：使用 `page.waitForFunction` 轮询「距离过期 ≤ 0」或把超时调到最小可校验值，不阻塞用例执行链（详见 TASK-006）。

---

# 7. 已确认 / 待确认（来自上游 Spec §7）

| 编号 | 内容 | 状态 | 处理 |
|------|------|------|------|
| I-01 | AA 仅发生在 CheckoutView，不污染 OrderView | 已确认（Spec §1.3） | 本设计严格落实：AA 入口只在 CheckoutView；OrderView 不消费 `aaSession` |
| I-02 | AA 仅展示，不对接真实通道 | 已确认 | 全部前端内存态，无新增依赖 |
| I-03 | 发起人「我先支付 ¥{{amount}}」是否纳入 v1 | **默认纳入**（Spec §7） | 复用 `AaPayDialog` 内 `aa_pay_self` 文案按钮；不引入第二条 PAY 链路；如 SPC 后续否定则改为隐藏该按钮，仅影响文案键 |
| I-04 | `aaRefundLogs` 与 `cancelLogs` 并列 | 已确认 | 字段命名与位置（`AppState` 紧随 `cancelLogs`）保持并列 |
| I-05 | AA 与订单履约阶段解耦的技术注释 | **采用落地**：reducer 顶部 JSDoc 注明（一句话即可，不单独建 ADR） | 由后续前端任务在 `orderReducer.ts` 顶部加注释；本设计不强制要求 ADR |
| I-06 | E2E 选择器命名（`aa-card-{diner}` / `aa-pay-confirm`） | 默认推荐沿用现有 kebab-case 风格 | 写入 §10 任务清单的「E2E 选择器约定」条目 |

> 以上 I-01~I-05 均沿用 Spec §7 默认行为；本节只是把 Spec 的「默认推荐」落地为可被代码侧直接采纳的实现选择，不涉及重新决策。

---

# 8. 数据契约对照表（Spec §4.4 ↔ Design §2.2）

本节把上游 `artifacts/产品Spec设计/产品 Spec：AA 结账/spec.md` §4.4 的契约对象与本 Design §2.2 字段一一对齐，方便后续 PR Review 时一眼校验。

| Spec 契约对象 | Design 数据模型位置 | 字段对齐 |
|---------------|---------------------|----------|
| `AaSession` | §2.2 `AaSession` 行 | 字段一致（含 SPEC 的 `allPaid`） |
| `AaSubOrder` | §2.2 `AaSubOrder` 行 | 字段一致（`status` 5 态 + 时间戳四类） |
| `AaRefundLog` | §2.2 `AaRefundLog` 行 | 字段一致；`status` 直接为 `'approved'`（不引入审批流） |
| `AppState` | §2.2 `AppState` 行 | `aaSession?` / `aaRefundLogs` 新增字段；兼容降级策略见 §3 |
| `moneyCents` / `centsToYuan` | §2.1 / §1.2 | 行为一致（前者输入为元输出为整数分，后者反向） |
| i18n 文案 | §2.1 / 任务清单 | 新增 `checkout.aa_*` / `message.aa_*` / `console.aa_*` |
| 路由 | §3 兼容性 | `#/checkout` 不变；不引入新顶级视图 |

---

# 9. 引用与版本

- 引用上游：
  - `artifacts/产品Spec设计/产品 Spec：AA 结账/spec.md`（finalized，已完成的 REQ-001~REQ-013 与 §7 I-01~I-06）
  - `artifacts/需求澄清/需求澄清：AA 结账/aa-checkout.requirement-clarification.md`（finalized，D-01=A / D-02=A / D-03=B / D-04=A / D-05=A）
- 引用仓库：仅 `caidaohan/deliveryai-demo`（`manifest.yaml`），当前 work_branch `feat/aa-checkout-6z90`；v1 基线 `6d1e455`、本 v2 修订前的实现层最新提交 `c31589d21a2391fde0ffdc9ef15493855cb5f9b5`（即 N4 `e1cfea1` + N6 `c31589d` 适配层）。
- v2 修订触发的下游回放：N4（前端开发）需基于本 v2 设计补 commit，使 Dialog 关闭二次确认真实生效；N6（自动化用例开发）保留 `c31589d` E2E，N4 修复后自动重跑 `e2e/aa-checkout.spec.ts` 全套。
- 引用知识：
  - `knowledge/template/技术设计模板.md`（本文件结构骨架）
  - `knowledge/template/任务拆分规范.md`（本节点的拆解成果落地方式）
  - `knowledge/design-system/kb-yewuxn95ogcp7vluobm0/DESIGN.md`（品牌色板与版式约束，本设计全部沿用现有 `bg-rice-100` / `text-chili-500` / `rounded-3xl` 等 Tailwind 类名，不引入新色阶）
  - `repos/caidaohan_deliveryai-demo/AGENTS.md`（仓库事实与「不要做」清单）
  - `repos/caidaohan_deliveryai-demo/docs/agent-testing.md`（E2E 与自审约束）
  - `repos/caidaohan_deliveryai-demo/docs/agent-release.md`（GitHub Pages 发布核验）
- 本 Design 仅与上一节点产品 Spec 对齐；未修改其结论。

---

# 10. 任务拆分（通往后续节点的入口）

本节给出下游「前端开发」「后端开发」「自动化用例开发」三节点的最小任务映射。详细拆解（同结构）见同级 `docs/requirements/aa-checkout.task-breakdown.md`，便于各节点直接使用。

## 10.1 前端开发任务（TASK-FE-*）

> v2 修订补注（TASK-FE-006 / TASK-FE-007）：N4 v1（commit `e1cfea1`）在 `AaPayDialog` 内独立维护了 `confirmCloseOpen` state 与 `AaPayCloseConfirmDialog` 组件，但因父子级拦截逻辑分散导致关闭二次确认 Dialog 实际不弹出（详见 `artifacts/自动化用例开发/caidaohan_deliveryai-demo@c31589d/content.json` 的失败原因段）。本设计 v2 显式锁定：二次确认 Dialog 由 `CheckoutView` 集中持有，`AaPayDialog` 仅透传 `onOpenChange`；N4 重做时**必须删除** `AaPayDialog.tsx` 中既有的 `confirmCloseOpen` state、删除或不再导出的 `AaPayCloseConfirmDialog` 组件；并保证 CheckoutView 内 `closeConfirmOpen` Dialog 是「关闭二次确认」唯一入口。

- [ ] TASK-FE-001 数据模型：在 `src/types.ts` 新增 `AaMode` / `AaSubOrderStatus` / `AaSession` / `AaSubOrder` / `AaRefundLog`；扩展 `AppState` / `AppAction`。
- [ ] TASK-FE-002 金额工具：在 `src/lib/utils.ts` 新增 `moneyCents` / `centsToYuan`。
- [ ] TASK-FE-003 reducer：在 `src/state/orderReducer.ts` 新增 8 个 `AA_*` case 与拆分辅助函数；顶部 JSDoc 标注「AA 与订单履约阶段解耦」。
- [ ] TASK-FE-004 i18n：在 `src/i18n.ts` 新增 `checkout.aa_*` / `message.aa_*` / `console.aa_*` 文案键；zh/en 同步。
- [ ] TASK-FE-005 hook：在 `src/hooks/useCountdown.ts` 新增倒计时 hook（含 `setTimeout` 到点过期 + 1Hz 倒计时刷新 + 三类 cleanup）。
- [ ] TASK-FE-006 组件：在 `src/components/AaPayDialog.tsx` 新增邀请卡 Dialog（**仅渲染主支付 Dialog，不持有任何内部 confirm 弹窗与 confirmCloseOpen state；无 AaPayCloseConfirmDialog 导出**）；`handleOpenChange(next) === onOpenChange(next)` 直接透传；并发守卫仅在 `handlePay` 内做 UI 层软拦截，reducer 守卫为最终边界。
- [ ] TASK-FE-007 视图：在 `src/components/CheckoutView.tsx` 集成 AA 入口 + 拆分面板 + 邀请卡列表 + 聚合视图 + 取消 / 退款 / reissue 入口 + **关闭二次确认 Dialog（`closeConfirmOpen`，与「取消 AA」「退款」二次确认并列）；`handlePayDialogOpenChange(next)` 在 `!next && payDialogOpen` 时仅 `setCloseConfirmOpen(true)`、拦截期间不调用 `setPayDialogOpen(next)`；二次确认 Dialog 内「放弃支付」按钮 `data-testid="aa-dialog-close-confirm"` 触发 `setPayDialogOpen(false)` + `setPayDialogDiner(null)` + `setCloseConfirmOpen(false)`，「返回/继续支付」按钮仅 `setCloseConfirmOpen(false)`**；保留单笔 PAY 路径。
- [ ] TASK-FE-008 控制台：在 `src/components/DemoConsole.tsx` 新增 AA 面板 + AA 退款日志面板。
- [ ] TASK-FE-009 入口：在 `src/App.tsx` 透传 AA_* action（hash 路由不变）。
- [ ] TASK-FE-010 验证：`npm run build` / `npm run lint` / `npx tsc -b --noEmit` 三连通过 + 旧 E2E `super-spicy` / `view-routing` / `return-dish` 全绿。

## 10.2 后端开发任务（TASK-BE-*）

- 无（仓库无后端，演示应用纯前端内存态；`server/` 仅健康检查，不涉及）。

## 10.3 自动化用例开发任务（TASK-E2E-*）

- [ ] TASK-E2E-001 新建 `e2e/aa-checkout.spec.ts`，按 §6 矩阵覆盖三类拆分 + 主流程 + 超时 + 取消 + 退款 + 重置；选择器沿用现有 kebab-case 风格（`aa-card-{diner}` / `aa-pay-confirm` / `aa-dialog-close-confirm`）。
- [ ] TASK-E2E-002 全量回归：与既有 `super-spicy.spec.ts` / `view-routing.spec.ts` / `return-dish.spec.ts` 单命令并行跑全绿。
- [ ] TASK-E2E-003 自审：按 `docs/agent-testing.md` §5 完成 commit 前自审（不引入 sleep / `waitForTimeout`，auto-retrying locator 优先，按钮点击驱动而非 dispatch）。
- [ ] TASK-E2E-004 文案键存在性自检：在用例 `beforeAll` 阶段 `rg -n` 关键文案键（如 `aa_confirm_split` / `aa_already_paid` / `aa_all_done_note` / `console.aa_section_title`）在 `src/i18n.ts` 双语均出现（轻量自检，不阻断用例）。

---

> 任务条目的勾选由各下游节点完成；本节点不进行实现、构建或代码提交。
