---
spec_id: aa-checkout.task-breakdown
title: 任务清单：AA 结账
status: finalized
template_id: task-breakdown
schema_version: 1
linked_spec: aa-checkout.spec
linked_design: aa-checkout.technical-spec
depends_on_designs: []
supersedes_designs: []
created_at: 2026-10-10
updated_at: 2026-10-10 (v2 revision)
supersedes: aa-checkout.task-breakdown v1 (commit 73281f5)
revision_notes:
  - v2 修订原因：N4 commit e1cfea1 实现 Dialog 关闭二次确认时，把 confirmCloseOpen state 和二次确认 Dialog 都放在 AaPayDialog 内部，与 CheckoutView 内的拦截逻辑分散，导致 SPEC §3 REQ-007 P0 业务侧 1 项 fail（E2E 详细原因见 artifacts/自动化用例开发/caidaohan_deliveryai-demo@c31589d/content.json）。
  - v2 修订范围：把「关闭二次确认」从 AaPayDialog（TASK-FE-007）的职责中移除，下沉到 CheckoutView（TASK-FE-008）作为唯一持有者；TASK-FE-007 不再有 confirmCloseOpen state、不再导出 AaPayCloseConfirmDialog。
  - v2 修订章节：TASK-FE-007 / TASK-FE-008 / TASK-E2E-001 用例约束。
  - v2 不修改范围：reducer、i18n 键集合、整体任务分组、其他节点任务。
---

# 任务清单: AA 结账（沸点火锅点单演示）

> 本任务清单由「技术 Spec 设计」节点产出，供「前端开发」「后端开发」「自动化用例开发」节点按域拆解承接。
> 上游：`artifacts/产品Spec设计/产品 Spec：AA 结账/spec.md`（REQ-001~REQ-013）。
> 设计：`docs/requirements/aa-checkout.technical-spec.md`（含 §10 概要任务与 §6 测试要点）。
> 本仓库无后端实现，因此「后端开发」任务清单为「无（N/A）」，下文保留条目用于结构对齐与未来扩展。
> 任务顺序体现依赖：TASK-FE-001 → 002 → 003 → 005 → 006 → 007 → 008 → 009 → 010；E2E 任务依赖前端任务全部落地。

## 0. 共享前提（所有节点开始前必读）

- 阅读 `artifacts/产品Spec设计/产品 Spec：AA 结账/spec.md` §1~§5 与本文件 §10 概要。
- 阅读 `repos/caidaohan_deliveryai-demo/AGENTS.md`（**不引入新依赖 / 不修改 server/ / 不引入新顶级视图 / hash 路由不变 / useReducer 内存态 / Radix Dialog / Tailwind 类名 / i18n 双语 / 老人模式自适应**）。
- 阅读 `docs/agent-testing.md`（E2E 自审与执行约束）。
- E2E 选择器约定（沿用现有 kebab-case 风格）：`aa-card-{diner}`、`aa-pay-confirm`、`aa-pay-abandon`、`aa-dialog-close-confirm`（**v2 必落于 CheckoutView 而非 AaPayDialog**）、`aa-cancel-all`、`aa-cancel-confirm`、`aa-refund-{diner}`、`aa-refund-confirm-{diner}`、`aa-reissue-{diner}`、`console-aa-timeout-input`、`console-aa-expire-all`、`console-aa-reset`、`console-aa-reset-confirm`、`checkout-aa-entry`、`checkout-aa-ratio-{diner}`、`checkout-aa-custom-{diner}`、`aa-cancel-entry`、`aa-dialog-close-back`。
- 拆分面板 Tab 实际为 `role="tab" + aria-selected`（N6 已对齐），E2E 定位时使用 `getByRole('tab', { name: /等额|按比例|自定义/ })`。
- 退款聚合视图文案「已退款 {{count}} 个子单」（key 为 `checkout.aa_refund_note`，N4 v1 已落地但 Spec 未列出，可保留；新版可统一规整 i18n 键）。
- 超时用例 E2E 推荐用 `console-aa-expire-all` 一键过期（避免 30s 真实等待阻塞套件）；如需测 `useCountdown` 的真实到期时间，再额外加一个 `timeoutMs = 30000` + `page.waitForFunction` 轮询子单状态 `expired` 的旁路用例，**不阻断**主流程。
- 已落地的 N6 commit `c31589d` 在数据细节上对齐了 N4 v1 的实现（详见 `artifacts/自动化用例开发/caidaohan_deliveryai-demo@c31589d/content.json`），N4 按本设计 v2 修复后无需重写 E2E 主体，仅复用 `c31589d` 文件即可。

---

## 1. 前端开发任务（TASK-FE-*）

### 1.1 数据模型与 reducer 基础

- [ ] TASK-FE-001 数据模型：在 `src/types.ts` 新增 `AaMode = 'equal' | 'ratio' | 'custom'`、`AaSubOrderStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded'`、`AaSession` / `AaSubOrder` / `AaRefundLog` 接口；扩展 `AppState`（`aaSession?: AaSession`、`aaRefundLogs: AaRefundLog[]`）；扩展 `AppAction`（8 个 `AA_*` action 形状按 `docs/requirements/aa-checkout.technical-spec.md` §2.2 / §2.4）。
- [ ] TASK-FE-002 金额工具：在 `src/lib/utils.ts` 新增 `moneyCents(yuan: number): number`（四舍五入到整数分）与 `centsToYuan(cents: number): number`（整数分 → 元，2 位小数）；`money()` 不动；导出 TS 类型 `Cents = number` 作为语义别名（便于阅读，文件内注释说明）。
- [ ] TASK-FE-003 reducer：在 `src/state/orderReducer.ts` 新增以下 case（按 SPEC §4.3 / Design §2.5）：
  - `AA_CREATE_SESSION`（含拆分辅助 `splitEqual` / `splitByRatio` / `splitByCustom`；默认 mode = `'equal'`；默认 `timeoutMs = 1_800_000`；按 diners 顺序生成 `pending` 子单；reducer 同时校验 `payableCents > 0`、`diners.length >= 2`、比例 Σ === 100 / 自定义金额差值为 0，三类校验失败直接 `SET_MESSAGE` + return，**不写入 aaSession**）。
  - `AA_PAY_SUB_ORDER`（守卫：sessionId 匹配、子单存在、`status === 'pending'`；满足则置 `paid`、打 `paidAt`、可能把 `state.paid` 升为 `true`）。
  - `AA_EXPIRE_SUB_ORDER`（守卫同上；非 `pending` return）。
  - `AA_CANCEL_ALL`（全部 `pending` / `expired` → `cancelled`；保留 paid；无 paid 且会话仍存在且只剩 cancelled/refunded 时把 `aaSession = undefined`、`paid = false`）。
  - `AA_REFUND_SUB_ORDER`（paid → refunded，打 `refundedAt`，append `aaRefundLog`；主单 `paid = false`）。
  - `AA_REISSUE_SUB_ORDER`（expired → pending，重置到点时间戳由 hook 计算，reducer 内不持久化时间戳即可）。
  - `AA_SET_TIMEOUT`（守卫 `[30_000, 1_800_000]`；越界 `SET_MESSAGE` + return）。
  - `AA_EXPIRE_ALL`（一次性把所有 pending → expired）。
  - `AA_RESET`（守卫 `action.sessionId === state.aaSession?.id`；清空 `aaSession` / `aaRefundLogs`，`paid = false`）。
- [ ] TASK-FE-004 顶部 JSDoc：在 `src/state/orderReducer.ts` 顶部加一段 JSDoc（一句话即可）：「AA 流程与 `orderStage` 解耦：AA 入口仅在 CheckoutView 渲染，子单状态独立于菜品履约阶段，不影响 `orderItems[].stage`。」

### 1.2 文案 / hook / 组件

- [ ] TASK-FE-005 i18n：在 `src/i18n.ts` 新增以下键（中英文均添加）：
  - `checkout.aa_entry`、`checkout.aa_section_title`、`checkout.aa_mode_equal`、`checkout.aa_mode_ratio`、`checkout.aa_mode_custom`、`checkout.aa_confirm_split`、`checkout.aa_split_invalid`、`checkout.aa_disabled_too_few`、`checkout.aa_disabled_no_amount`、`checkout.aa_progress`、`checkout.aa_progress_format`、`checkout.aa_status_pending`、`checkout.aa_status_paid`、`checkout.aa_status_expired`、`checkout.aa_status_cancelled`、`checkout.aa_status_refunded`、`checkout.aa_timeout_label`、`checkout.aa_cancel_all`、`checkout.aa_cancel_confirm`、`checkout.aa_refund_one`、`checkout.aa_refund_confirm`、`checkout.aa_reissue`、`checkout.aa_already_paid`、`checkout.aa_dialog_close_confirm`、`checkout.aa_pay_sub`、`checkout.aa_pay_self`、`checkout.aa_pay_abandon`、`checkout.aa_all_done_note`、`checkout.aa_coupon_used`、`checkout.aa_expired_count`。
  - `console.aa_section_title`、`console.aa_timeout_label`、`console.aa_expire_all`、`console.aa_reset`、`console.aa_reset_confirm`、`console.aa_refund_log_title`、`console.aa_refund_log_empty`、`console.aa_refund_log_reason`。
  - `message.aa_created`、`message.aa_invalid_session`、`message.aa_already_paid`、`message.aa_timeout_range`、`message.aa_cancelled`、`message.aa_refunded`。
- [ ] TASK-FE-006 新建 `src/hooks/useCountdown.ts`：输入 `aaSession: AaSession | undefined` 与 `onExpire: (diner: string) => void`；内部分两块 `useEffect`：（a）对每个 pending 子单计算 `expiryAt = createdAt + timeoutMs`，在到点 `setTimeout(() => onExpire(sub.diner), expiryAt - Date.now())`；（b）1Hz `setInterval` 推进局部 `setState(now => now+1)` 用于渲染 mm:ss；cleanup 在 `aaSession === undefined` / 子单转为非 pending / 组件卸载三类路径清理两类定时器；返回 `{ remainingMs(diner: string), formatted(diner: string): 'mm:ss' }`。
- [ ] TASK-FE-007 v2 重写：修改 `src/components/AaPayDialog.tsx`（按 v2 设计，**不持有任何内部 confirm 弹窗与 confirmCloseOpen state；删除既有 `AaPayCloseConfirmDialog` 导出**）：
  - Props = `{ open, onOpenChange, session, diner, amountCents, items, onPay, onAbandon }`。
  - 渲染：单一 `<Dialog open={open} onOpenChange={handleOpenChange}>` 内容 = 标题「以 {{name}} 身份支付」（`aa_pay_sub`）+ 子单金额卡片（含 `data-testid="aa-pay-amount"`） + 订单概况（菜品列表用 `centsToYuan → money`）+ 「确认支付 ¥{{amount}}」按钮 (`data-testid="aa-pay-confirm"`) + 「放弃」按钮 (`data-testid="aa-pay-abandon"`)。
  - **`handleOpenChange(next)` 直接 `onOpenChange(next)` 透传给父级 CheckoutView，不再持有任何 confirmCloseOpen state、不再返回拦截；**这与 v1 设计相反，是 v2 的关键变更。
  - 「放弃」按钮：`onAbandon()` + `onOpenChange(false)`（不做任何 reducer 写入；只是 UI 关闭）。
  - 「确认支付」按钮：`onPay()` 让 reducer 守卫处理（reducer 内 `status !== 'pending'` 时 `SET_MESSAGE(aa_already_paid)`），UI 不拦截；若 reducer 成功支付，则 `handlePay` 内 `onOpenChange(false)` 关闭 Dialog。
  - **必须删除**：v1 中 `AaPayCloseConfirmDialog` 组件的导出与文件内定义（避免误用）；v1 中的 `confirmCloseOpen` state 与拦截 return 分支。
- [ ] TASK-FE-008 v2 重写：修改 `src/components/CheckoutView.tsx`（按 v2 设计，**集中持有「关闭二次确认」Dialog**）：
  - 新增 AA 入口（`checkout.aa_entry`）与拆分面板（三 Tab + 等额只读 / 比例输入 / 自定义金额输入 + 「确认拆分并邀请」）；面板默认折叠，按钮可见性按 SPEC §3 REQ-001。
  - 生成 `aaSession` 后整片隐藏原「选择支付方式」卡片 + 成功页条件（沿用 `state.paid === true` 判定，但 AA 全部 paid 时 `state.paid = true` 仍走成功页 + AA 已结清附注）。
  - 渲染邀请卡列表：每张卡片用 `bg-white rounded-3xl p-5 shadow-card`（与现有 SPEC §4.1 视觉一致），顶部 diner 名、中部金额、mm:ss 倒计时、底部状态徽章；`paid` 状态绿色对勾 + `bg-emerald-50`；`expired` 灰色 + `border-charcoal-900/10` + 倒计时清零；`cancelled` 灰色 + 删除线金额；`refunded` 灰色 + `text-amber-500`。
  - 邀请卡点击 → 打开 `AaPayDialog`；卡片点击区 `data-testid={`aa-card-${diner}`}`；Dialog「确认支付」按钮 `data-testid="aa-pay-confirm"`（位于 AaPayDialog 内）；「放弃」按钮 `data-testid="aa-pay-abandon"`（位于 AaPayDialog 内）。
  - **`handlePayDialogOpenChange(next)` 在 `!next && payDialogOpen` 时仅 `setCloseConfirmOpen(true)` 拦截、不调用 `setPayDialogOpen(next)`，避免主 Dialog 真的关闭；其它分支正常 `setPayDialogOpen(next)`。**
  - **新增「关闭二次确认 Dialog」（位于 CheckoutView，紧邻「取消 AA / 退款」二次确认）**：
    - 状态 `closeConfirmOpen` 与 v1 一致。
    - 内容：文案 `checkout.aa_dialog_close_confirm` + 「放弃支付」按钮 (`data-testid="aa-dialog-close-confirm"`：`setPayDialogOpen(false)` + `setPayDialogDiner(null)` + `setCloseConfirmOpen(false)` 三件事一起做) + 「返回/继续支付」按钮（仅 `setCloseConfirmOpen(false)`，主 Dialog 维持打开）。
  - 「取消 AA」按钮 + 二次确认 Dialog（「取消 AA」+「继续支付」+ 按钮 `data-testid="aa-cancel-all"` / `aa-cancel-confirm"`）。
  - 任一 `paid` 子单卡片右下角「为 {{name}} 退款」按钮 + 二次确认；按钮 `data-testid={`aa-refund-${diner}`}` / `aa-refund-confirm-${diner}`；确认后 reducer 跑 `AA_REFUND_SUB_ORDER`，`aa_already_paid` / `aa_cancelled` 文案沿用。
  - 任一 `expired` 子单卡片右下角「重新发起」按钮 `data-testid={`aa-reissue-${diner}`}`；点击 dispatch `AA_REISSUE_SUB_ORDER`。
  - 聚合视图：顶部一条「已支付 N/M，总额 ¥X.XX / ¥Y.YY」进度条 + N/M 大字；优惠文案按 SPEC §REQ-013 处理。

### 1.3 DemoConsole 与应用入口

- [ ] TASK-FE-009 修改 `src/components/DemoConsole.tsx`：新增 AA 面板与 AA 退款日志面板；Props 新增 `aaSession` / `aaRefundLogs` / `onAaSetTimeout(ms)` / `onAaExpireAll()` / `onAaReset()` / `onAaRefundSubOrder(diner)` / `onAaReissueSubOrder(diner)`；新增二次确认 Dialog「重置 AA」（`aa_reset` / `aa_reset_confirm`）；按钮 `data-testid="console-aa-expire-all"` / `console-aa-reset"` / `console-aa-reset-confirm"`；数值输入框 `data-testid="console-aa-timeout-input"`。
- [ ] TASK-FE-010 修改 `src/App.tsx`：把 `aaSession` / `aaRefundLogs` / 7 个回调透传给 `CheckoutView` 与 `DemoConsole`；hash 路由 `#/checkout` 不变；不在此节点引入新顶级视图。

### 1.4 验证

- [ ] TASK-FE-011 跑 `npm run build` / `npm run lint` / `npx tsc -b --noEmit`：三连通过、零警告。
- [ ] TASK-FE-012 跑 `npx playwright test e2e/super-spicy.spec.ts e2e/view-routing.spec.ts e2e/return-dish.spec.ts`：旧 E2E 全绿，无退化。

---

## 2. 后端开发任务（TASK-BE-*）

- [ ] TASK-BE-000 N/A：沸点火锅点单演示为纯前端 SPA，业务逻辑全部运行在浏览器内存态，不依赖后端 API；`server/` 仅承载健康检查，不参与 AA / 支付 / 退菜 / 桌台业务链路。本节点不产出代码改动。
- [ ] TASK-BE-001 仅供未来扩展占位（不实施）：若未来 AA 需要持久化或多端同步，需新增「AA 会话」「子单」「退款日志」三张表的 DDL 与 REST/TRPC 接口；本期范围不做。

---

## 3. 自动化用例开发任务（TASK-E2E-*）

### 3.1 用例设计

- [ ] TASK-E2E-001 新建 `e2e/aa-checkout.spec.ts`，按 SPEC §6 / Design §6 矩阵落地：
  - 公共 helper：`enterCheckoutWithOrder(page, { dinersCount = 3, dishes = [...] })` 负责绑定桌台 → 加购物车 → 提交订单 → 进入 CheckoutView；返回当前 `payable` 与 `diners`。
  - 测试分组（`test.describe`）：
    - `AA-拆分-等额-主流程`：3 人 diners、构造菜品使 `payable = 100.00`；选等额；确认拆分并邀请；断言三张邀请卡金额依次为 `¥33.34 / ¥33.33 / ¥33.33`；依次点击邀请卡完成支付（使用 `dialog` 定位）；断言聚合视图「已支付 3/3」+ 成功页「AA 已结清」附注。
    - `AA-拆分-比例-Σ=100`：比例 50/30/20，对应付 120.00；断言邀请卡 `¥60.00 / ¥36.00 / ¥24.00`。
    - `AA-拆分-比例-Σ≠100`：比例改为 50/30/19，断言「确认拆分并邀请」按钮 `disabled`。
    - `AA-拆分-自定义-Σ=99.99`：按需填入使 Σ = 99.99，断言按钮点亮；改一位使 Σ = 99.98，断言按钮置灰且红字差额提示。
    - `AA-入口-可见性-diners<2`：构造 diners.length === 1 场景，断言「AA 结账」按钮 `disabled` 并提示 `aa_disabled_too_few`。
    - `AA-入口-可见性-payable===0`：构造空购物车 / 全部菜 approved 取消，断言按钮 disabled 并提示 `aa_disabled_no_amount`。
    - `AA-子单-支付与并发防重`：1 子单 paid 后再次点击邀请卡 + 点「确认支付」 → 断言 `aa_already_paid` 文案可见；不变更聚合与 paid 状态。
    - `AA-超时-到点-expired`：DemoConsole 调 `timeoutMs = 30_000`（数值输入 + 回车），发起 AA → 不点击任何邀请卡 → 使用 `page.waitForFunction` 轮询卡片状态 `expired`（不阻塞用例） → 断言「X 个子单已超时」文案。
    - `AA-超时-reissue`：在上一场景基础上点「重新发起」 → 子单回到 `pending`，倒计时显示 mm:ss。
    - `AA-取消-全部 pending/expired`：构造 2 pending 1 expired 场景 → 点「取消 AA」 → 二次确认 → 断言全部 `cancelled`、已支付子单保持 paid、回到单笔 PAY 视图。
    - `AA-退款-单子单`：1 子单 paid → 点「为 {{name}} 退款」 → 二次确认 → 断言子单 `refunded`、DemoConsole AA 退款日志新增一条、聚合视图显示「1 已退款」。
    - `AA-DemoConsole-重置`：发起 AA → 1 子单 paid → 点「重置 AA」 → 二次确认 → 断言 `aaSession` 清空，回到单笔 PAY 路径。
    - `AA-优惠-满 100 减 30`：构造 subtotal ≥ 100 → 发起 AA → 断言「本单已使用 ¥30 会员菜品券」文案；聚合视图与邀请卡金额文案不含「券」字。
    - `AA-单笔 PAY-保留`：AA 尚未发起时，原「确认支付 {{amount}}」按钮可用；AA 全部完成 / 全部取消 / DemoConsole 重置后单笔 PAY 再次可用。
    - `AA-Dialog-关闭-二次确认`（v2 必过用例）：打开 `AaPayDialog` → 通过 Radix 关闭按钮 / Esc / 遮罩任一方式触发 `onOpenChange(false)` → 断言**位于 CheckoutView 内**的二次确认 Dialog 真实出现（含 `aa-dialog-close-confirm` 测试按钮；不在 AaPayDialog 内部）；点「返回/继续支付」→ 主 Dialog 与二次确认 Dialog 状态保持（主 Dialog 仍打开，二次确认 Dialog 关闭）；点「放弃支付」→ 主 Dialog 与二次确认 Dialog 都关闭、子单状态不变更（`aa_already_paid` 不应触发，因为这是单纯的「放弃」不是「重复支付」）；与 `AA-子单-支付与并发防重` 用例区分。
  - 选择器全部沿用 §0 约定的 `aa-card-{diner}` / `aa-pay-confirm` / `aa-dialog-close-confirm` 等 kebab-case；定位优先级 `getByRole` > `getByText` > `[data-testid=...]`。
- [ ] TASK-E2E-002 自审（提交前）：按 `docs/agent-testing.md` §5 完成 commit 前自审清单；不引入 `sleep` / `waitForTimeout`；唯一例外为「等子单到 30s 过期」使用 `page.waitForFunction` 轮询状态，到点即返回，不阻塞套件整体时长。
- [ ] TASK-E2E-003 跑全部受影响用例：`npx playwright test e2e/aa-checkout.spec.ts e2e/super-spicy.spec.ts e2e/view-routing.spec.ts e2e/return-dish.spec.ts`；旧 E2E 全绿，新 E2E 全过。
- [ ] TASK-E2E-004 文案键存在性自检：在 `test.beforeAll` 阶段通过 `node -e` 读 `src/i18n.ts`，断言关键键（`aa_entry` / `aa_confirm_split` / `aa_already_paid` / `aa_all_done_note` / `aa_timeout_label` / `console_aa_section_title` / `message_aa_invalid_session` 等）zh/en 双语均出现；不一致时用例 fail fast 并提示缺失的 key 列表。

### 3.2 验证

- [ ] TASK-E2E-005 `npm run lint` / `npm run build` 通过；无 console 报错；trace on failure 已开启。

---

## 4. 验证与收尾

- [ ] TASK-VAL-001 汇总三节点的提交与 PR；不在本节点触发合并（合并动作由仓库 / CI 决定）。
- [ ] TASK-VAL-002 在合并前对 PR 做一次最终 self-review：检查 §1.1 任务勾选完整、无无关 diff、未引入未授权依赖、未触发 `do-not` 列表；与同级设计文档交叉检查 §2.2 / §2.4 字段一致性。
- [ ] TASK-VAL-003 准备给「集成测试」与「发布部署验证」节点的接力输入：列出新增 E2E 套件、关键文案键清单、可观察的页面行为（AA 入口可见性 / 拆分 / 邀请卡 / 超时 / 取消 / 退款 / 重置 / 成功页）。

---

> 本任务清单不替代 PR description；任务勾选由各下游节点维护，commit message 与 PR description 由各节点分别负责。
