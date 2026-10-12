---
doc_id: aa-checkout.requirement-clarification
title: 需求澄清：AA 结账
status: finalized
template_id: requirement-clarification
schema_version: 1
created_at: 2026-10-10
updated_at: 2026-10-10
source_documents:
  - 用户原始任务描述（增加 AA 结账功能）
  - repos/caidaohan_deliveryai-demo/AGENTS.md（仓库事实与约定）
  - repos/caidaohan_deliveryai-demo/README.md（演示功能清单）
  - repos/caidaohan_deliveryai-demo/src/types.ts（现有 AppState/OrderItem）
  - repos/caidaohan_deliveryai-demo/src/state/orderReducer.ts（订单/支付 reducer）
  - repos/caidaohan_deliveryai-demo/src/components/CheckoutView.tsx（现有结账视图）
  - repos/caidaohan_deliveryai-demo/src/i18n.ts（zh/en 文案键）
  - knowledge/template/需求澄清规范.md
confirmed_items:
  D-01: A
  D-02: A
  D-03: B
  D-04: A
  D-05: A
---

# 需求澄清：AA 结账

> 本文件遵循 `knowledge/template/需求澄清规范.md` 的结构与字段粒度。`待确认`/`推断` 标记见文末清单；产品 Spec 设计节点以定稿版本为输入。所有 D-01~D-05 已通过人机交互确认。

---

## 1. 一句话概述

在【沸点火锅点单演示的"核对本桌账单"页（CheckoutView）】中增加【AA（平摊）结账能力】，使【桌台发起人】能够【把一笔订单按等额/按比例/自定义金额拆分给同桌伙伴，由各参与人在同一台设备上点击邀请卡并触发子单支付，订单主状态在全部子单完成或被取消时聚合刷新】，同时【不改变后端依赖、不引入新的 UI 框架、不破坏现有单笔结账和退菜（REQ-001~007）链路】。

---

## 2. 背景与目标

### 背景
- 火锅门店常出现同桌多人分摊账单的实际场景，现有演示只支持单一发起人整笔结账（`paid: boolean`），无法表达"分账→聚合"的体验。
- 当前 `CheckoutView` 内只有一个 `onPay` 触发 `PAY` reducer，把整张订单置为已支付；缺乏子单、邀请、支付进度视图。
- 用户原始任务明确要求"按人均/比例/自定义"三种拆分模式，以及超时/撤销/对账退款等典型 AA 体验要素，需在 Demo 中以内存态等价实现。
- 仓库规范（AGENTS.md）约束：不引入新 UI 库、不修改 `server/`、不改 React Router、不引入后端 API；改动需沿用 `useReducer` 内存态 + Tailwind 类名 + i18n 双语同步。

### 目标
- 发起人在 CheckoutView 可一键切换至「AA 结账」模式，按等额 / 按比例 / 自定义金额三种规则拆分。
- 同一台设备内：发起人侧生成可点击「邀请卡」（Radix Dialog），被邀请人通过点击邀请卡切换为本人视角并完成子单支付；主单聚合状态实时刷新为「待 X 支付」「已支付 N/M」「全部完成」。
- 发起人可在任何未完成阶段取消整张 AA；未付子单超过默认 30 分钟（演示控制台可调到最小 30 秒）自动作废；已支付子单通过 `aaRefundLogs` 独立链路按子单粒度退款。
- 全程金额精度正确：内部以"分"整数累加，无丢分/重复扣款；中英文文案同步；无新增依赖。

### 不做
- 不引入真实支付通道、不对接任何外部 API；所有"支付"为前端内存态事件。
- 不实现真正的邮件/短信/IM 通道；邀请仅以"可点击邀请卡 + Radix Dialog"在同设备呈现。
- 不改变现有 `cancelLogs` 退菜链路的核心结构；AA 退款走独立的 `aaRefundLogs`，与 cancelLogs 并列。
- 不调整会员/优惠券/排号等其他业务面；现有 ¥30 满减券按"先整单减再拆分"策略处理（详见 §3 产品规则）。
- 不改视图集合上限以外的路由协议；不引入新顶级视图（子单邀请详情用 Dialog 承载）。
- 不改动 `server/`、不引入额外 UI 框架/设计系统/状态库。

---

## 3. 需求详情

### 用户场景
- **发起人（同一桌的"姚乾"或任意主加的人）**：进入 CheckoutView，看到原"核对本桌账单"基础上多出一个「AA 结账」入口；选择拆分模式，分配金额，生成邀请卡列表，实时观察各子单支付状态；可主动取消或按子单单对已支付子单退款。
- **被邀请人（通过点击邀请卡进入"以林溪/陈默身份支付"的状态）**：在 Radix Dialog 中看到自己分摊的金额、订单概况和未付余额，点击"确认支付"完成子单。
- **门店服务员/演示控制台操作员**（沿用现有 DemoConsole）：在演示侧可手动调整超时时长、触发"全部超时"、查看 `aaRefundLogs`、一键重置，便于讲解与 E2E。

### 用户路径
1. 发起人进入 CheckoutView（路径：home → welcome → menu → order → checkout，绑定桌台后直达）。
2. 在「选择支付方式」卡片上方出现「AA 结账」入口（默认折叠为按钮，点开展开拆分面板）。
3. 系统弹出拆分面板，发起人选择拆分模式（等额 / 按比例 / 自定义金额），确认参与人（来自 `state.diners`，发起人默认包含），按规则生成子单与每人金额。
4. 发起人点击「确认拆分并邀请」生成「邀请卡」列表；每张邀请卡展示被邀请人姓名、子单金额、有效期倒计时（默认 30 分钟）、「待支付」状态；切换到 AA 视图后原「选择支付方式」隐藏。
5. 发起人点击某张邀请卡 → 打开 Radix Dialog「以 {{name}} 身份支付」：展示订单概况、该子单金额、支付方式选项；点击「确认支付 ¥{{amount}}」触发子单完成。
6. 主单聚合视图实时显示「已支付 N/M，总额 ¥X.XX / ¥Y.YY」；全部完成时聚合为「AA 已结清」等价 `paid=true` 成功页；未全部完成时维持 AA 视图。
7. 异常路径：发起人随时可「取消 AA」（未全部完成时）；超时（默认 30 分钟；演示可调到 30 秒）自动作废未付子单；任一被邀请人点击「放弃支付」退出 AA Dialog。

### 产品规则
- **触发与入口**：仅当 `state.orderItems` 非空、未全部 `cancelState === 'approved'`、且 `paid === false` 时，「AA 结账」入口可见；进入 AA 后原单笔支付隐藏或置灰。
- **优惠券（D-02=A）**：在 CheckoutView 现有「满 ¥100 减 ¥30」逻辑完成后取 `payable = subtotal - discount`，AA 仅对 `payable` 进行拆分；子单不再独立判定满减；退款时若整笔 AA 取消则 coupon 不计入已支付子单（文案注明「券未使用」）。
- **拆分模式**（三种并列，默认等额）：
  - **等额**：以"分"为最小单位 `payableCents / 参与人数` 整除，余数按参与人顺序累加 1 分（金额从大到小递减），保证 Σ = `payableCents`。
  - **按比例**：发起人输入每位参与人整数比例（百分比，0–100），比例合计必须等于 100；未达 100 时确认按钮置灰并提示差额；按比例分配 `payableCents`，最终子单累加等于 `payableCents`。
  - **自定义金额**：发起人依次填写每位参与人的金额（≥ 0.01，≤ `payable` − 已分配），所有金额合计必须等于 `payable`（精度 0.01）；不通过则确认按钮置灰并高亮差额。
- **金额精度（D-05=A）**：
  - `utils.moneyCents(value: number) => number`：把外部传入的"元"四舍五入到整数分。
  - `utils.centsToYuan(cents: number) => number`：把整数分转为"元"（保留两位小数的 number，用于展示）。
  - 所有 reducer 内的金额比较/累加/拆分必须以整数"分"为单位（`payableCents`、`subOrderCents`）；展示时再用 `centsToYuan` 转回 `number`，再走现有 `money()`。
  - 测试断言一律使用整数"分"，避免浮点误差。
- **币种**：本期仅人民币 ¥，不引入多币种。
- **参与人**：仅取 `state.diners`（演示默认 ['姚乾', '林溪', '陈默']）；发起人默认在参与人列表内且不可被剔除；参与人 ≥ 2 时才允许发起 AA。
- **邀请通道（D-01=A）**：
  - AA 视图下生成「邀请卡」列表（按参与人顺序），每张卡显示姓名、子单金额、倒计时（mm:ss）、状态徽章（待支付 / 已支付 / 已超时 / 已取消 / 已退款）。
  - 点击邀请卡 → 打开 Radix Dialog「以 {{name}} 身份支付」，内含订单概况、本人分摊金额、支付方式、底部操作「确认支付」「放弃」。
  - 不实现"角色切换"下拉（控制台不提供"以谁的身份"切换），但 DemoConsole 提供「AA 全部超时」/「重置 AA」/「调整超时」等加速/E2E 用动作。
- **子单聚合**：AA 模式下 `AppState` 新增 `aaSession?: AaSession`，结构（由 Spec 节点细化）：
  - `id: string`（uuid 降级方案见 `lib/utils.uid`）
  - `mode: 'equal' | 'ratio' | 'custom'`
  - `ratioInputs?: Record<diner, number>`（按比例模式）
  - `customInputs?: Record<diner, number>`（自定义模式，元）
  - `subOrders: AaSubOrder[]`：`{ diner, amountCents, status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded', paidAt?, expiredAt?, refundedAt? }`
  - `timeoutMs: number`（默认 1_800_000；演示可调到 30_000）
  - `createdAt: string` ISO
  - `allPaid: boolean`（reducer 计算属性，子单全 paid 时为 true）
- **主单 `paid` 字段**：AA 全部子单为 `paid` 后 `paid = true`（等价"订单已支付"成功页）；取消全部未付子单且无已支付子单时 `paid = false`；有任意子单被退款时 `paid = false` 并展示「N 已退款」提示。
- **超时（D-04=A）**：
  - 未付子单超过 `timeoutMs` 后自动标记 `expired`；前端 `setTimeout` + `useEffect` 在 AA 会话创建时启动，到期后 dispatch `AA_EXPIRE_SUB_ORDER`。
  - `timeoutMs` 默认 30 分钟；DemoConsole 提供数值输入（最小 30 秒，最大 30 分钟），便于 E2E 加速。
  - 发起人可对已超时子单手动「重新发起」（重置为 pending 并重置倒计时）。
- **取消**：发起人点击「取消 AA」→ 取消全部 `pending`/`expired` 子单；已支付子单**不**自动退款，由发起人按子单单触发退款（走 `aaRefundLogs`）。
- **退款（D-03=B）**：
  - `AppState` 新增 `aaRefundLogs: AaRefundLog[]`，与 `cancelLogs` 并列独立：`{ id, sessionId, diner, amountCents, reason: 'aa_cancel' | 'aa_other', note?: string, requestedBy: 'customer', requestedAt: string, decisionAt: string, status: 'approved' }`。
  - DemoConsole 增列「AA 退款日志」面板，与现有「退菜操作日志」并列展示。
  - 本期退款仅由发起人触发，且不需审批（演示场景，直接 status=approved）；保留日志字段仅为后续扩展。
- **并发保护**：同一被邀请人重复点击「确认支付」时，reducer 内 `if (subOrder.status === 'paid') return state` 守卫，第二次及以后直接驳回；不引入乐观锁/版本号。
- **空数据 / 边界**：
  - 当 `state.diners.length < 2` 时，AA 入口置灰且 tooltip「至少 2 人参与才可发起 AA」。
  - 当应付合计为 0（全部菜品被退菜批准）时，AA 入口置灰且 tooltip「无可结清金额」。
- **保持不变**：单笔结账、退菜（REQ-001~007）、服务呼叫、菜品售罄、订单履约阶段的逻辑与文案均不受影响；E2E 既有 spec（`super-spicy.spec.ts`、`view-routing.spec.ts`、`return-dish.spec.ts`）需保持通过。

### 状态与反馈
- **成功**：
  - 子单支付成功 → 该子单卡片状态置「已支付」，发起人聚合视图数字 `已支付 N/M` 递增；文案 `message.aa_subpayer_paid: '{{name}} 已完成 ¥{{amount}}'`。
  - 全部完成 → 主单 `paid = true`，展示现有「付款完成」成功页；可附加一行 `checkout.aa_all_done_note: 'AA 已结清，感谢同桌一起承担'`。
- **失败**：
  - 拆分校验失败（比例总和不等于 100、金额总和不等于 `payable`）→ 表单内红字提示差额，按钮置灰，文案：`checkout.aa_split_invalid: '拆分合计应为 ¥{{amount}}（差额 ¥{{diff}}）'`。
  - 被邀请人重复点击 → Dialog 内提示 `checkout.aa_already_paid: '本笔已支付'`。
- **空态**：
  - 未绑定桌台或在 home/welcome 视图 → AA 入口不可见。
  - 参与人 < 2 人或 `payable = 0` → AA 入口置灰并 tooltip。
- **无权限**：
  - 演示无真实账号；发起人取消/退款通过按钮实现；其他人不能代发起人操作（在 UI 上隐藏入口）。
- **异常**：
  - 超时 → 子单标 `expired`，聚合视图标红「X 个子单已超时」，文案：`checkout.aa_status_expired: '{{count}} 个子单已超时'`。
  - 取消 → 子单标 `cancelled`，聚合视图显示「AA 已取消」；已支付子单保持 `paid` 状态等待发起人按子单退款。
  - 系统异常 → 沿用现有 `lastMessage` 顶层黑条提示，如 `message.aa_unknown_error`。
- **保持不变**：
  - 单笔 `PAY` 路径不退场，作为"非 AA 模式"仍可用。
  - 退菜、菜品售罄、服务呼叫流程不受 AA 影响。
  - 视图 URL hash 路由（`home/welcome/menu/order/checkout`）保持不变。

### 关键文案（仅列待 Spec/Design 锁定的关键项）
- 主按钮：`checkout.aa_start: '发起 AA 结账'`、`checkout.aa_confirm_split: '确认拆分并邀请'`、`checkout.aa_pay_sub: '为 {{name}} 支付 ¥{{amount}}'`、`checkout.aa_pay_self: '我先支付 ¥{{amount}}'`
- 模式切换：`checkout.aa_mode_equal: '等额'`、`checkout.aa_mode_ratio: '按比例'`、`checkout.aa_mode_custom: '自定义金额'`
- 聚合状态：`checkout.aa_progress: '{{paid}}/{{total}} 已支付'`、`checkout.aa_remaining: '还差 ¥{{amount}}'`、`checkout.aa_all_done: 'AA 已结清'`
- 异常项：`checkout.aa_status_expired: '{{count}} 个子单已超时'`、`checkout.aa_status_refunded: '{{count}} 个子单已退款'`、`checkout.aa_cancel_all: '取消 AA'`、`checkout.aa_refund_one: '为 {{name}} 退款'`、`checkout.aa_reissue: '重新发起'`、`checkout.aa_already_paid: '本笔已支付'`
- 演示控制台：`console.aa_section_title: 'AA 结账演示'`、`console.aa_expire_all: '模拟全部超时'`、`console.aa_reset: '重置 AA'`、`console.aa_timeout_label: 'AA 超时（演示）'`
- 日志：`console.aa_refund_log_title: 'AA 退款日志（最近 20 条）'`、`console.aa_refund_log_empty: '尚无 AA 退款'`

> 完整文案由 Spec 节点在 `src/i18n.ts` 的 zh/en 两处补齐；本节只列对设计与评审有约束的关键句。

### 关键表现要求
- AA 入口在 CheckoutView 中与现有「选择支付方式」卡片视觉对齐（同一 `rounded-3xl bg-white shadow-card` 容器），不引入新的视觉层级。
- 邀请卡采用 Grid 布局（移动端单列、桌面 2–3 列），每张卡显示：姓名 + 子单金额 + 倒计时 + 状态徽章 + 「以 {{name}} 身份支付」按钮（点击打开 Dialog）。
- 自定义金额输入控件沿用 Tailwind 输入样式，`inputmode="decimal"`；倒计时按秒刷新，到期后整张卡置灰并加 `border-charcoal-900/10`。
- 聚合进度使用现有 `bg-amber-100/70` 圆角卡背景，沿用品牌色板（rice/charcoal/chili），不引入新颜色。
- Dialog 内复用现有 Radix `Dialog` 组件，关闭时需确认（避免误操作导致放弃支付）。

---

## 4. 约束限制

- **权限/角色**：演示无真实账号；发起人 = 当前绑定桌台会话；被邀请人通过点击邀请卡 Dialog 切换，无越权操作。
- **兼容/数据**：`AppState` 新增 `aaSession` / `aaRefundLogs` 字段需保证旧状态解析不报错，初始化阶段做"字段缺失→空值"降级；现有 `paid` 字段保持布尔语义。
- **性能/前端**：所有计算在 reducer/`useMemo` 内完成；不引入 IndexedDB、外部存储；定时器使用前端 `setTimeout`/`useEffect`，卸载时清理；倒计时刷新频率 1Hz。
- **稳定性/降级**：AA 模块不可用时（拆分校验异常、超时未付）必须保留原有"单笔结账"路径；任何 AA 操作不破坏 `paid/cancelLogs/services` 状态。
- **依赖**：不引入新 npm 包；沿用 React 18、TypeScript、Tailwind、Radix Dialog、lucide-react、react-i18next、class-variance-authority、clsx/tailwind-merge。
- **测试/验证**：新增 E2E 用例 `e2e/aa-checkout.spec.ts` 覆盖：发起→等额/比例/自定义拆分→邀请卡点击→子单支付→聚合→超时→退款→重置；旧 E2E（super-spicy / view-routing / return-dish）保持绿。
- **构建/质量**：`npm run build`、`npm run lint`、`npx tsc -b --noEmit`、`npx playwright test` 全部通过。
- **实现边界**：
  - 不改 `server/`（仅健康检查）
  - 不引入 CSS Modules / styled-components / CSS 变量层
  - 不修改 hash 路由协议本身（`useViewRoute.ts` 的 `VIEWS` 不扩展，但 `viewToHash/hashToView` 的实现可被其内部使用保持不变）
  - 不改现有视图命名约定（`*View.tsx` 与 `ViewName` 一一对应；不新增顶级视图）
  - 不引入乐观锁/版本号/消息队列等并发原语
- **金额/币种**：内部以"分"为最小单位计算；展示仍为 `¥xx.xx`；本期不引入汇率/多币种。

---

## 5. 验收标准

- [主流程-等额] 在【绑定桌台、3 人参与、应付合计 ¥100.00】下，发起人在 CheckoutView 点击「发起 AA」→ 选择等额 → 金额显示 ¥33.34 / ¥33.33 / ¥33.33，三人合计 ¥100.00；每位被邀请人通过点击邀请卡 Dialog 完成支付后，主单 `paid = true` 且展示「AA 已结清」。
- [主流程-比例] 在【3 人参与、应付合计 ¥120.00】下按比例 50/30/20，金额显示 ¥60.00 / ¥36.00 / ¥24.00；比例总和 ≠ 100 时确认按钮置灰并提示差额。
- [主流程-自定义] 在【3 人参与、应付合计 ¥99.99】下自定义金额，三人填写的金额合计等于 ¥99.99（精度 0.01），否则确认按钮置灰。
- [主流程-聚合] AA 视图下，已支付子单数 N/M 实时刷新；全部完成时跳转/展示 `paid=true` 成功页。
- [边界-参与人不足] `diners.length < 2` 或 `payable = 0` 时，AA 入口置灰且不可点击，出现提示文案。
- [边界-并发防重] 同一被邀请人在子单已支付状态下再次点击「确认支付」，Dialog 内提示「本笔已支付」，子单状态与 `paid` 不变。
- [边界-超时] 在【演示控制台将超时设为 30 秒】下，未付子单在到期后自动变为「已超时」，聚合视图显示「X 个子单已超时」；发起人可见「重新发起」入口，点击后该子单回到 pending 且倒计时重置。
- [边界-取消] 发起人在任一未完成阶段点击「取消 AA」，全部 `pending/expired` 子单变为 `cancelled`；已支付子单不被自动退款，由发起人按子单单触发退款。
- [边界-退款] 任一已支付子单触发退款后，该子单状态变为 `refunded`，DemoConsole「AA 退款日志」新增一条；主单聚合状态显示「N 已退款」，且该子单不再纳入「全部完成」判定。
- [边界-优惠券] 当 `subtotal ≥ 100` 时，AA 拆分针对 `payable = subtotal - 30` 进行；任意子单金额文案应不含"券"，发起人侧有"本单已使用 ¥30 会员菜品券"提示。
- [兼容-单笔结账] AA 模式关闭或未发起时，原「确认支付 {{amount}}」按钮路径保持可用；文案不敏感。
- [兼容-旧视图/旧用例] 三个现有 E2E（`super-spicy`、`view-routing`、`return-dish`）保持通过；hash 路由地址 `#/checkout` 不变；不引入新顶级视图。
- [内容正确性] zh/en 文案键齐全（`checkout.aa_*`、`message.aa_*`、`console.aa_*`），未出现 `??`/`<待确认>` 占位符。
- [精度] 任意拆分后子单金额累加严格等于 `payableCents`（整数比较），无丢分。
- [异常处理] 拆分校验失败、超时、并发重试、演示控制台"全部超时"等异常场景，均有对应 Dialog/Toast/聚合状态文案，原单笔结账不被破坏。
- [性能/构建] `npm run build`/`npm run lint`/`npx tsc -b --noEmit` 全部通过；新增 E2E `e2e/aa-checkout.spec.ts` 通过且不引入 `sleep`/固定 `waitForTimeout`。

---

## 6. 待确认清单（已确认）

### 6.1 缺失信息（已通过 2026-10-10 人机交互确认）
- **D-01 邀请通道的演示形态** → **A**：发起人侧生成可点击「邀请卡」，通过 Radix Dialog 切换为被邀请人视角；DemoConsole 不提供"角色切换"下拉，仅保留超时/重置等加速动作。
- **D-02 ¥30 满减券与 AA 拆分的关系** → **A**：先对整单计算券额（`payable = subtotal - 30`），再把 `payable` 拆分到人；不再独立判断各子单是否满减。
- **D-03 AA 退款链路归属** → **B**：`AppState` 新增 `aaRefundLogs` 与 `cancelLogs` 并列；DemoConsole 增列「AA 退款日志」面板。
- **D-04 AA 超时机制** → **A**：默认 30 分钟 `setTimeout`，DemoConsole 可调到最小 30 秒，便于 E2E；超时自动标 `expired`，发起人可「重新发起」。
- **D-05 拆分金额精度** → **A**：内部一律以整数"分"累加；新增 `utils.moneyCents` / `utils.centsToYuan`；reducer 中所有金额比较与累加按整数"分"。

### 6.2 冲突信息（无）
- 当前用户任务描述、模板规范、仓库 AGENTS.md/README.md 与本定稿不存在冲突。

### 6.3 推断项（评审时确认）
- **I-01**：AA 入口仅在 CheckoutView 出现，OrderView 不出现；理由：与"结账支付"语义贴合，避免污染订单履约视图。**已被 D-01 默认行为吸收（仅在 CheckoutView 渲染邀请卡）。**
- **I-02**：AA 模式不引入新顶级视图；邀请卡详情用 Radix Dialog 承载。**已被 D-01 默认行为吸收。**
- **I-03**：发起人默认在 AA 参与人之列；若发起人选择"我先支付"可提前减少剩余人数（reducer 中按子单状态聚合判定）。**保留；非阻塞。**
- **I-04**：退款仅支持"按子单单由发起人触发"，不在本期引入"被邀请人主动申请退款"。**已被 D-03 默认行为吸收。**
- **I-05**：AA 与服务呼叫、菜品售罄、订单履约阶段完全解耦；理由：业务上 AA 仅发生在 `checkout` 视图。**
- **I-06**：倒计时与超时由前端 `setTimeout` + `useEffect` 驱动，不持久化；卸载时清理定时器。**已被 D-04 默认行为吸收。**

---

## 7. 后续节点输入说明

- **产品 Spec 设计**（下一节点）：以本定稿文件为输入，输出产品 Spec（`knowledge/template/需求Spec模板.md`），需在 `5.2 风险与待确认` 中消化 D-01~D-05 的结论（已定稿），并对 I-03/I-05 做显式确认/驳回。Spec 必须给出 `AaSession`、`AaSubOrder`、`AaRefundLog` 类型与 reducer action 清单。
- **技术 Spec 设计**：负责 reducer 新增 action（如 `AA_CREATE_SESSION`、`AA_CONFIRM_SPLIT`、`AA_PAY_SUB_ORDER`、`AA_EXPIRE_SUB_ORDER`、`AA_CANCEL_ALL`、`AA_REFUND_SUB_ORDER`、`AA_REISSUE_SUB_ORDER`）、`utils.moneyCents/centsToYuan` 工具函数、E2E 用例 `e2e/aa-checkout.spec.ts` 的覆盖矩阵；不应回写需求边界。
- **前端开发**：
  - 扩展 `src/types.ts`：新增 `AaSession`、`AaSubOrder`、`AaRefundLog`、`AaSubOrderStatus`、`AaMode`；`AppState` 新增 `aaSession?: AaSession`、`aaRefundLogs: AaRefundLog[]`。
  - 扩展 `src/state/orderReducer.ts`：新增上述 action；`AA_CREATE_SESSION` 时按模式计算 `subOrders[].amountCents`；`AA_PAY_SUB_ORDER` 检查状态守卫。
  - 扩展 `src/lib/utils.ts`：新增 `moneyCents`、`centsToYuan`；`money` 保持现有行为。
  - 扩展 `src/components/CheckoutView.tsx`：AA 入口、邀请卡列表、聚合进度、取消/重新发起按钮。
  - 新增 `src/components/AaPayDialog.tsx`：被邀请人支付 Dialog。
  - 扩展 `src/components/DemoConsole.tsx`：AA 超时调整、全部超时、重置 AA、AA 退款日志面板。
  - 扩展 `src/i18n.ts`：zh/en 新增 `aa_*` 文案键。
- **自动化用例开发**：`e2e/aa-checkout.spec.ts` 需覆盖 §5 验收标准中所有 `[主流程]`、`[边界]`、`[异常处理]` 条目。
- **联调 / 集成测试**：仅前端内存态，联调指"前端 + 演示控制台 + E2E"三方一致；如需可视化演示脚本，由产品节点补充。
- **后端**：本 Demo 无后端，本期无 `server/` 改动；如未来扩展实时通知/聚合对账，需另立新需求。

---

## 8. 引用与版本

- 引用共享产物：当前 `artifacts/_manifest.json` 为空（无上游产物）；后续节点（产品 Spec / 技术 Spec）会基于本文件生成新产物。
- 引用仓库：仅 `caidaohan/deliveryai-demo`（manifest.yaml 指定），当前 work_branch `feat/aa-checkout-6z90`。
- 引用知识：
  - `knowledge/template/需求澄清规范.md`（结构与字段粒度来源）
  - `knowledge/template/需求Spec模板.md`（下游模板）
  - `knowledge/design-system/kb-yewuxn95ogcp7vluobm0/DESIGN.md`（品牌色板、版式、间距约束）
  - `repos/caidaohan_deliveryai-demo/AGENTS.md`（仓库事实与"不要做"清单）
  - `repos/caidaohan_deliveryai-demo/docs/agent-testing.md`（E2E 与自审约束）
