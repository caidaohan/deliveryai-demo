import { test, expect, type Page, type Locator } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = fileURLToPath(new URL('.', import.meta.url))
import { resolve } from 'node:path'

/**
 * AA 结账（AA Checkout）E2E 验收矩阵。
 *
 * 设计依据：
 * - 产品 Spec：docs/requirements/aa-checkout.spec.md §3 REQ-001~REQ-013 + §6 验收清单
 * - 技术 Spec：docs/requirements/aa-checkout.technical-spec.md §6 测试要点 + §2.4 接口契约
 * - 任务清单：docs/requirements/aa-checkout.task-breakdown.md §0 选择器约定 + §3 TASK-E2E-001
 *
 * 选择器约定（沿用仓库 kebab-case 风格，与 return-dish.spec.ts 一致）：
 *   - 邀请卡：data-testid="aa-card-{diner}"
 *   - 拆分确认：data-testid="aa-confirm-split"
 *   - Dialog 确认支付 / 放弃 / 关闭二次确认：aa-pay-confirm / aa-pay-abandon / aa-dialog-close-confirm
 *   - 取消 AA / 二次确认：aa-cancel-all / aa-cancel-confirm
 *   - 退款 / 二次确认：aa-refund-{diner} / aa-refund-confirm-{diner}
 *   - 重新发起：aa-reissue-{diner}
 *   - DemoConsole 超时输入 / 全部超时 / 重置 / 二次确认：console-aa-timeout-input / console-aa-expire-all / console-aa-reset / console-aa-reset-confirm
 *   - CheckoutView AA 入口：checkout-aa-entry
 */

// 构造菜品组合：
//   p1（锅底，¥68）+ p6（海鲜，¥46）+ p9（主食，¥16）= ¥130 → 满减 ¥30 → 应付 ¥100
// 该构造用于「等额拆分 Σ=100」「比例拆分 Σ=100」「自定义拆分 Σ=100」「优惠文案」「主流程聚合」用例。
const FIXTURE_DISH_PRICES = [68, 46, 16] as const
const FIXTURE_SUBTOTAL = FIXTURE_DISH_PRICES.reduce((sum, p) => sum + p, 0)
const FIXTURE_PAYABLE = FIXTURE_SUBTOTAL >= 100 ? FIXTURE_SUBTOTAL - 30 : FIXTURE_SUBTOTAL

// 默认 diners（来自 src/state/orderReducer.ts initialState.diners）
const DEFAULT_DINERS = ['姚乾', '林溪', '陈默'] as const

/**
 * 文案键存在性自检（任务清单 TASK-E2E-004 / SPEC §5.1）。
 * 在 test.beforeAll 中调用，缺失时 fail-fast 让 CI 立刻暴露翻译不全问题。
 *
 * 实现思路：在 src/i18n.ts 源文件中按 `key: 'value'` 形式匹配关键文案，
 * 要求每个键至少出现 2 次（即 zh 与 en 各定义一次）。
 */
const REQUIRED_I18N_KEYS = [
  // checkout.* AA 文案（key 名直接来自任务清单 §1.5）
  'aa_entry', 'aa_section_title', 'aa_mode_equal', 'aa_mode_ratio', 'aa_mode_custom',
  'aa_confirm_split', 'aa_split_invalid', 'aa_disabled_too_few', 'aa_disabled_no_amount',
  'aa_progress', 'aa_progress_format', 'aa_status_pending', 'aa_status_paid',
  'aa_status_expired', 'aa_status_cancelled', 'aa_status_refunded', 'aa_timeout_label',
  'aa_cancel_all', 'aa_cancel_confirm', 'aa_refund_one', 'aa_refund_confirm',
  'aa_reissue', 'aa_already_paid', 'aa_dialog_close_confirm', 'aa_pay_sub', 'aa_pay_self',
  'aa_pay_abandon', 'aa_all_done_note', 'aa_coupon_used', 'aa_expired_count',
  // console.* AA 文案
  'aa_expire_all', 'aa_reset', 'aa_reset_confirm',
  'aa_refund_log_title', 'aa_refund_log_empty',
  // message.* AA 文案
  'aa_created', 'aa_invalid_session',
  'aa_timeout_range', 'aa_cancelled', 'aa_refunded',
] as const

function assertI18nKeys(): void {
  const i18nPath = resolve(__dirname, '..', 'src', 'i18n.ts')
  const source = readFileSync(i18nPath, 'utf8')
  const missing: string[] = []
  for (const key of REQUIRED_I18N_KEYS) {
    // 形如 "key: 'value'" 至少 2 次（即 zh + en 至少各一次）
    const re = new RegExp(`${key}\\s*:\\s*['"\`][^'"\`]+['"\`]`, 'g')
    const matches = source.match(re) || []
    if (matches.length < 2) {
      missing.push(`${key} (${matches.length})`)
    }
  }
  if (missing.length) {
    throw new Error(`AA i18n key missing in zh/en (need ≥ 2 occurrences): ${missing.join(', ')}`)
  }
}

/**
 * 绑定桌台 → 进入点餐 → 加购指定菜品 → 提交订单 → 进入 CheckoutView。
 * 默认按 FIXTURE_DISH_PRICES 构造应付 ¥100，可通过 `dishPrices` 覆盖。
 */
async function enterCheckoutWithOrder(
  page: Page,
  options: { dishPrices?: readonly number[] } = {},
): Promise<{ payable: number; diners: readonly string[] }> {
  await page.goto('/')
  // 1. 绑定 A08 桌台
  await page.getByRole('button', { name: /A08/ }).first().click()
  // 2. 进入点餐
  await page.getByRole('button', { name: /进入点餐|Enter/ }).click()
  await expect(page).toHaveURL(/#\/menu$/)

  // 3. 按价格列表加购（推荐/锅底/海鲜/牛羊肉/蔬菜豆品/主食饮品 共 6 个类目）
  const prices = options.dishPrices ?? FIXTURE_DISH_PRICES
  for (const price of prices) {
    await addDishByPrice(page, price)
  }

  // 4. 提交订单 → OrderView
  await page.getByRole('button', { name: /确认并提交订单/ }).click()
  await expect(page).toHaveURL(/#\/order$/)

  // 5. 跳到 CheckoutView
  await page.getByRole('button', { name: /去结账/ }).click()
  await expect(page).toHaveURL(/#\/checkout$/)

  const subtotal = prices.reduce((sum, p) => sum + p, 0)
  const payable = subtotal >= 100 ? subtotal - 30 : subtotal
  return { payable, diners: DEFAULT_DINERS }
}

/** 按价格寻找菜品的 article 卡片（默认类目顺序：推荐→锅底→海鲜→牛羊肉→蔬菜豆品→主食饮品）。 */
async function addDishByPrice(page: Page, price: number): Promise<void> {
  const article = page.locator('article').filter({ hasText: `¥${price.toFixed(2)}` }).first()
  await article.waitFor({ state: 'visible' })
  // 点击最后一个按钮（一般是 + 或 选规格入口）
  await article.getByRole('button').last().click()
  // 等待规格弹窗打开：必有「加入本桌购物车」按钮
  const addBtn = page.getByRole('button', { name: /加入本桌购物车/ })
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  await expect(addBtn).not.toBeVisible()
}

/** 打开演示控制台（顶栏「演示」入口）。 */
async function openDemoConsole(page: Page): Promise<void> {
  await page.getByRole('button', { name: /演示|Demo/ }).first().click()
  await expect(page.getByText('演示控制台')).toBeVisible()
}

test.describe('AA 结账 - E2E 验收矩阵', () => {
  test.beforeAll(() => {
    assertI18nKeys()
  })

  test.describe('AA-拆分-等额', () => {
    test('AA-主流程-等额：3 人均摊应付 ¥100，Σ 严格相等 + 全部完成 → 主单 paid + AA 已结清附注', async ({ page }) => {
      const { payable } = await enterCheckoutWithOrder(page)
      expect(payable).toBe(FIXTURE_PAYABLE)

      // AA 入口可见且可点击
      const aaEntry = page.getByTestId('checkout-aa-entry')
      await expect(aaEntry).toBeVisible()
      await expect(aaEntry).toBeEnabled()

      // 打开拆分面板
      await aaEntry.click()
      // 默认等额模式
      await expect(page.getByRole('button', { name: '等额' })).toHaveAttribute('aria-pressed', 'true')

      // 「确认拆分并邀请」
      const confirmBtn = page.getByTestId('aa-confirm-split')
      await expect(confirmBtn).toBeEnabled()
      await confirmBtn.click()

      // 邀请卡列表：3 张，按 diners 顺序展示金额（33.34 / 33.33 / 33.33）
      const cardYaoqian = page.getByTestId('aa-card-姚乾')
      const cardLinxi = page.getByTestId('aa-card-林溪')
      const cardChenmo = page.getByTestId('aa-card-陈默')
      await expect(cardYaoqian).toBeVisible()
      await expect(cardLinxi).toBeVisible()
      await expect(cardChenmo).toBeVisible()
      await expect(cardYaoqian).toContainText('¥33.34')
      await expect(cardLinxi).toContainText('¥33.33')
      await expect(cardChenmo).toContainText('¥33.33')

      // Σ 严格相等校验
      const amounts = await Promise.all([cardYaoqian, cardLinxi, cardChenmo].map(readCardAmount))
      expect(amounts.reduce((s, v) => s + v, 0)).toBeCloseTo(payable, 2)

      // 主流程：依次完成支付
      await paySubOrder(page, '姚乾')
      await expect(page.getByText(/已支付\s*1\s*\/\s*3/)).toBeVisible()

      await paySubOrder(page, '林溪')
      await expect(page.getByText(/已支付\s*2\s*\/\s*3/)).toBeVisible()

      await paySubOrder(page, '陈默')
      // 全部 paid → 主单 paid = true → 成功页 + 「AA 已结清」附注
      await expect(page.getByText('付款完成')).toBeVisible()
      await expect(page.getByText('AA 已结清')).toBeVisible()
    })
  })

  test.describe('AA-拆分-比例', () => {
    test('AA-拆分-比例-Σ=100：50/30/20 拆分应付 100，邀请卡 50/30/20', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      await openSplitPanel(page, 'ratio')

      for (const [i, ratio] of [50, 30, 20].entries()) {
        const input = page.getByRole('spinbutton', { name: new RegExp(DEFAULT_DINERS[i]) })
        await input.fill(String(ratio))
      }
      await expect(page.getByTestId('aa-confirm-split')).toBeEnabled()
      await page.getByTestId('aa-confirm-split').click()

      await expect(page.getByTestId('aa-card-姚乾')).toContainText('¥50.00')
      await expect(page.getByTestId('aa-card-林溪')).toContainText('¥30.00')
      await expect(page.getByTestId('aa-card-陈默')).toContainText('¥20.00')
    })

    test('AA-拆分-比例-Σ≠100：确认按钮置灰，提示差额', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      await openSplitPanel(page, 'ratio')

      for (const [i, ratio] of [50, 30, 19].entries()) {
        const input = page.getByRole('spinbutton', { name: new RegExp(DEFAULT_DINERS[i]) })
        await input.fill(String(ratio))
      }
      await expect(page.getByTestId('aa-confirm-split')).toBeDisabled()
      // 差额提示（文案键 aa_split_invalid）：还差 ¥1.00
      await expect(page.getByText(/还差\s*¥?\s*1\.?00?/)).toBeVisible()
    })
  })

  test.describe('AA-拆分-自定义', () => {
    test('AA-拆分-自定义-Σ=payable：三位合计严格相等时按钮点亮', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      await openSplitPanel(page, 'custom')

      // Σ = 33.34 + 33.33 + 33.33 = 100.00
      const splits = ['33.34', '33.33', '33.33']
      for (const [i, amount] of splits.entries()) {
        const input = page.getByRole('spinbutton', { name: new RegExp(DEFAULT_DINERS[i]) })
        await input.fill(amount)
      }
      await expect(page.getByTestId('aa-confirm-split')).toBeEnabled()
    })

    test('AA-拆分-自定义-Σ≠payable：合计不等时按钮置灰且红字差额', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      await openSplitPanel(page, 'custom')

      // Σ = 33.34 + 33.33 + 33.32 = 99.99，差 0.01
      const splits = ['33.34', '33.33', '33.32']
      for (const [i, amount] of splits.entries()) {
        const input = page.getByRole('spinbutton', { name: new RegExp(DEFAULT_DINERS[i]) })
        await input.fill(amount)
      }
      await expect(page.getByTestId('aa-confirm-split')).toBeDisabled()
      await expect(page.getByText(/还差\s*¥?\s*0\.01/)).toBeVisible()
    })
  })

  test.describe('AA-边界-并发防重', () => {
    test('AA-子单-支付与并发防重：已支付子单再次点确认支付显示 aa_already_paid', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      await createEqualSplitSession(page)

      // 第一次支付
      await paySubOrder(page, '姚乾')
      // 再次点击同一张卡片：尝试再次完成支付
      await page.getByTestId('aa-card-姚乾').click()
      await page.getByTestId('aa-pay-confirm').click()
      // reducer 守卫 + Toast 提示
      await expect(page.getByText('本笔已支付')).toBeVisible()
      // 聚合仍为 1/3
      await expect(page.getByText(/已支付\s*1\s*\/\s*3/)).toBeVisible()
    })
  })

  test.describe('AA-边界-超时', () => {
    test('AA-超时-到点-expired：30s 后子单自动 expired', async ({ page }) => {
      test.setTimeout(90_000)
      await enterCheckoutWithOrder(page)
      await openDemoConsole(page)

      // 设置超时 = 30_000ms
      const input = page.getByTestId('console-aa-timeout-input')
      await input.fill('30000')
      await input.press('Enter')
      await page.getByRole('button', { name: '完成设置' }).click()

      // 发起 AA（等额）
      await page.getByTestId('checkout-aa-entry').click()
      await page.getByTestId('aa-confirm-split').click()
      await expect(page.getByTestId('aa-card-姚乾')).toBeVisible()

      // 轮询等待所有 pending → expired（SPEC §6/技术 §6 明确这是唯一允许的真实等待）
      await page.waitForFunction(
        () => {
          const cards = Array.from(document.querySelectorAll('[data-testid^="aa-card-"]'))
          return cards.length > 0 && cards.every((el) => /已超时|expired/i.test(el.textContent || ''))
        },
        undefined,
        { timeout: 60_000, polling: 1_000 },
      )

      // 聚合视图显示「X 个子单已超时」
      await expect(page.getByText(/已超时/)).toBeVisible()
    })

    test('AA-超时-reissue：过期子单点「重新发起」回到 pending 并显示倒计时', async ({ page }) => {
      test.setTimeout(90_000)
      await enterCheckoutWithOrder(page)
      await openDemoConsole(page)

      const input = page.getByTestId('console-aa-timeout-input')
      await input.fill('30000')
      await input.press('Enter')
      await page.getByRole('button', { name: '完成设置' }).click()

      await page.getByTestId('checkout-aa-entry').click()
      await page.getByTestId('aa-confirm-split').click()

      // 等到过期
      await page.waitForFunction(
        () => {
          const cards = Array.from(document.querySelectorAll('[data-testid^="aa-card-"]'))
          return cards.length > 0 && cards.every((el) => /已超时|expired/i.test(el.textContent || ''))
        },
        undefined,
        { timeout: 60_000, polling: 1_000 },
      )

      // 对第一张过期卡片点「重新发起」
      await page.getByTestId('aa-reissue-姚乾').click()
      // 卡片回到 pending + 倒计时 mm:ss 显示
      const card = page.getByTestId('aa-card-姚乾')
      await expect(card).toContainText('待支付')
      await expect(card).toContainText(/\d{2}:\d{2}/)
    })
  })

  test.describe('AA-边界-取消', () => {
    test('AA-取消-全部 pending/expired：取消后回到单笔 PAY，已支付子单保持 paid', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      await createEqualSplitSession(page)

      // 第一个子单支付
      await paySubOrder(page, '姚乾')

      // 取消 AA（剩余两个 pending）
      await page.getByTestId('aa-cancel-all').click()
      // 二次确认
      await expect(page.getByText(/确认取消\s*AA|取消\s*AA/)).toBeVisible()
      await page.getByTestId('aa-cancel-confirm').click()

      // 已支付子单（姚乾）保持 paid；其余子单 → cancelled
      await expect(page.getByTestId('aa-card-林溪')).toContainText('已取消')
      await expect(page.getByTestId('aa-card-陈默')).toContainText('已取消')
      await expect(page.getByTestId('aa-card-姚乾')).toContainText('已支付')

      // 回到单笔 PAY 路径
      const singlePayBtn = page.getByRole('button', { name: /确认支付/ })
      await expect(singlePayBtn).toBeVisible()
    })
  })

  test.describe('AA-边界-退款', () => {
    test('AA-退款-单子单：已支付子单退款，二次确认，状态 → refunded + AA 退款日志追加', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      await createEqualSplitSession(page)
      await paySubOrder(page, '姚乾')

      // 触发退款
      await page.getByTestId('aa-refund-姚乾').click()
      // 二次确认
      await page.getByTestId('aa-refund-confirm-姚乾').click()

      // 卡片显示已退款
      await expect(page.getByTestId('aa-card-姚乾')).toContainText('已退款')

      // 聚合视图显示「1 已退款」
      await expect(page.getByText(/1\s*已退款/)).toBeVisible()

      // 打开 DemoConsole，AA 退款日志新增一条
      await openDemoConsole(page)
      await expect(page.getByTestId('console-aa-refund-log')).toBeVisible()
      await expect(page.getByText('姚乾').first()).toBeVisible()
    })
  })

  test.describe('AA-DemoConsole-重置', () => {
    test('AA-DemoConsole-重置：清除会话与日志，回到单笔 PAY', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      await createEqualSplitSession(page)
      await paySubOrder(page, '姚乾')

      await openDemoConsole(page)
      await page.getByTestId('console-aa-reset').click()
      // 二次确认
      await page.getByTestId('console-aa-reset-confirm').click()
      await page.getByRole('button', { name: '完成设置' }).click()

      // 回到单笔 PAY 路径
      await expect(page.getByRole('button', { name: /确认支付/ })).toBeVisible()
      // 邀请卡列表清空
      await expect(page.getByTestId('aa-card-姚乾')).toHaveCount(0)
    })
  })

  test.describe('AA-内容正确性', () => {
    test('AA-优惠-满 100 减 30：聚合视图保留「本单已使用 ¥30 会员菜品券」', async ({ page }) => {
      const { payable } = await enterCheckoutWithOrder(page)
      expect(payable).toBe(FIXTURE_PAYABLE)

      await page.getByTestId('checkout-aa-entry').click()
      await page.getByTestId('aa-confirm-split').click()

      // 聚合视图文案保留券提示
      await expect(page.getByText(/本单已使用\s*¥30\s*会员菜品券/)).toBeVisible()
      // 邀请卡金额文案不含「券」字
      const cards = await Promise.all(
        DEFAULT_DINERS.map((diner) => page.getByTestId(`aa-card-${diner}`).textContent()),
      )
      for (const text of cards) {
        expect(text || '').not.toMatch(/券/)
      }
    })
  })

  test.describe('AA-兼容-单笔 PAY', () => {
    test('AA-单笔 PAY-保留：未发起 AA 时原「确认支付」按钮可用', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      // 还未点 AA 入口 → 「确认支付 {{amount}}」按钮可见且可用
      const singlePayBtn = page.getByRole('button', { name: /确认支付/ })
      await expect(singlePayBtn).toBeVisible()
      await expect(singlePayBtn).toBeEnabled()
    })
  })

  test.describe('AA-Dialog-关闭', () => {
    test('AA-Dialog-关闭-二次确认：点遮罩关闭出现二次确认；点「继续支付」保留 Dialog', async ({ page }) => {
      await enterCheckoutWithOrder(page)
      await createEqualSplitSession(page)

      // 打开邀请卡 Dialog
      await page.getByTestId('aa-card-姚乾').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      // 点遮罩关闭（Radix Overlay 选择器，与 return-dish.spec.ts REQ-004.2 同模式）
      const overlay = page.locator('[data-state="open"][aria-hidden="true"]').last()
      await overlay.click({ force: true, position: { x: 5, y: 5 } })

      // 二次确认出现
      await expect(page.getByText(/是否放弃支付|二次确认/)).toBeVisible()
      // 「继续支付」按钮
      await page.getByRole('button', { name: /继续支付/ }).click()
      // Dialog 仍然在
      await expect(dialog).toBeVisible()
    })
  })
})

// ---------- helpers ----------

/** 打开 AA 拆分面板并切换到指定 mode。 */
async function openSplitPanel(page: Page, mode: 'equal' | 'ratio' | 'custom'): Promise<void> {
  await page.getByTestId('checkout-aa-entry').click()
  const labelMap = { equal: '等额', ratio: '按比例', custom: '自定义金额' } as const
  await page.getByRole('button', { name: labelMap[mode] }).click()
}

/** 创建一次等额拆分会话（默认 3 人 / 默认 30min 超时）。 */
async function createEqualSplitSession(page: Page): Promise<void> {
  await page.getByTestId('checkout-aa-entry').click()
  await expect(page.getByRole('button', { name: '等额' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('aa-confirm-split').click()
  await expect(page.getByTestId('aa-card-姚乾')).toBeVisible()
}

/** 读取邀请卡片内金额数字（解析 ¥XX.XX）。 */
async function readCardAmount(card: Locator): Promise<number> {
  const text = (await card.textContent()) || ''
  const match = text.match(/¥\s*(\d+(?:\.\d+)?)/)
  if (!match) throw new Error(`邀请卡金额解析失败：${text}`)
  return Number(match[1])
}

/** 点邀请卡 → 在 Dialog 内点「确认支付」→ 关闭 Dialog。 */
async function paySubOrder(page: Page, diner: string): Promise<void> {
  await page.getByTestId(`aa-card-${diner}`).click()
  const confirm = page.getByTestId('aa-pay-confirm')
  await expect(confirm).toBeVisible()
  await confirm.click()
  // Dialog 关闭（普通支付完成）
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
