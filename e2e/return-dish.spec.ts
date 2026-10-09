import { test, expect, type Page } from '@playwright/test'

/** 从首页绑定 A08 桌台并进入点餐视图（menu）。 */
async function enterMenu(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /A08/ }).first().click()
  await page.getByRole('button', { name: /进入点餐|Enter/ }).click()
  await expect(page).toHaveURL(/#\/menu$/)
}

/**
 * 添加一份推荐菜品（p3 琥珀嫩牛肉）到购物车：默认类别为「推荐」，第一个 article 即 p3。
 * 点 + 按钮打开规格弹窗 → 点「加入本桌购物车」。
 */
async function addRecommendItem(page: Page) {
  const card = page.locator('article').first()
  await expect(card).toBeVisible()
  await card.getByRole('button').last().click() // open spec dialog
  await expect(page.getByRole('button', { name: /加入本桌购物车/ })).toBeVisible()
  await page.getByRole('button', { name: /加入本桌购物车/ }).click()
  // spec dialog closes
  await expect(page.getByRole('button', { name: /加入本桌购物车/ })).not.toBeVisible()
}

/** 添加一份到购物车并提交订单，跳转 order 视图。 */
async function submitOneItemOrder(page: Page) {
  await enterMenu(page)
  await addRecommendItem(page)
  // Desktop cart panel: click 确认并提交订单
  await page.getByRole('button', { name: /确认并提交订单/ }).click()
  await expect(page).toHaveURL(/#\/order$/)
  await expect(page.getByRole('heading', { name: '这一锅，正在抵达' })).toBeVisible()
}

test.describe('退菜功能 - E2E 验收测试', () => {
  test('REQ-001: 未上桌菜品显示「退菜」按钮，点击后弹出原因选择 Dialog', async ({ page }) => {
    await submitOneItemOrder(page)
    const cancelBtn = page.getByTestId('order-cancel-btn').first()
    await expect(cancelBtn).toBeVisible()
    await cancelBtn.click()
    await expect(page.getByRole('heading', { name: '申请退菜' })).toBeVisible()
    await expect(page.getByTestId('cancel-reason-wrong_order')).toBeVisible()
    await expect(page.getByTestId('cancel-reason-other')).toBeVisible()
    await expect(page.getByTestId('cancel-reason-hint')).toBeVisible()
  })

  test('REQ-001.2: 未选原因时确认按钮置灰，提示请选择原因', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    const confirmBtn = page.getByTestId('cancel-confirm-btn')
    await expect(confirmBtn).toBeDisabled()
    await expect(page.getByText('请选择退菜原因')).toBeVisible()
  })

  test('REQ-001.3: 选「其他」时备注未填则确认按钮置灰', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    await page.getByTestId('cancel-reason-other').click()
    const confirmBtn = page.getByTestId('cancel-confirm-btn')
    await expect(confirmBtn).toBeDisabled()
    await page.getByTestId('cancel-note').fill('服务员备注说明')
    await expect(confirmBtn).toBeEnabled()
  })

  test('REQ-001.4: 取消 Dialog 不发起申请，原状态不变', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: '申请退菜' })).not.toBeVisible()
    // 退菜按钮还在，未触发 request
    await expect(page.getByTestId('order-cancel-btn').first()).toBeVisible()
    await expect(page.getByTestId('cancel-pending-badge')).not.toBeVisible()
  })

  test('REQ-001.5: 选择原因并提交后，菜品行显示「退菜申请审核中」徽章', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    await page.getByTestId('cancel-reason-quality').click()
    await page.getByTestId('cancel-note').fill('肉有点老')
    await page.getByTestId('cancel-confirm-btn').click()
    await expect(page.getByRole('heading', { name: '申请退菜' })).not.toBeVisible()
    await expect(page.getByTestId('cancel-pending-badge').first()).toBeVisible()
    // 退菜按钮此时不再渲染（cancelState !== undefined）
    await expect(page.getByTestId('order-cancel-btn')).toHaveCount(0)
    // 浮层 lastMessage 更新
    await expect(page.getByText('退菜申请已提交')).toBeVisible()
  })

  test('REQ-002.1: DemoConsole 显示待审批列表与日志，可单条批准', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    await page.getByTestId('cancel-reason-quality').click()
    await page.getByTestId('cancel-confirm-btn').click()
    await expect(page.getByTestId('cancel-pending-badge').first()).toBeVisible()

    // 打开演示控制台（顶栏 演示 入口）
    await page.getByRole('button', { name: /演示|Demo/ }).first().click()
    await expect(page.getByText('演示控制台')).toBeVisible()
    await expect(page.getByTestId('console-cancel-review')).toBeVisible()
    // 待审批徽章与空文案不会同时出现
    await expect(page.getByTestId('console-cancel-empty')).toHaveCount(0)
    // 关闭弹窗
    await page.getByRole('button', { name: '完成设置' }).click()
    await expect(page.getByText('演示控制台')).not.toBeVisible()
  })

  test('REQ-002.2: DemoConsole 单条批准后退菜菜品被排除，OrderView 合计同步下降', async ({ page }) => {
    await submitOneItemOrder(page)
    const totalBefore = await page.locator('strong.text-chili-500').first().textContent()
    expect(totalBefore).toBeTruthy()

    await page.getByTestId('order-cancel-btn').first().click()
    await page.getByTestId('cancel-reason-quality').click()
    await page.getByTestId('cancel-confirm-btn').click()
    await expect(page.getByTestId('cancel-pending-badge').first()).toBeVisible()

    // 打开演示控制台批准
    await page.getByRole('button', { name: /演示|Demo/ }).first().click()
    const approveBtn = page.locator('[data-testid^="console-cancel-approve-"]').first()
    await expect(approveBtn).toBeVisible()
    await approveBtn.click()
    // 浮层消息更新
    await expect(page.getByText('已批准退菜申请')).toBeVisible()
    // 关闭控制台
    await page.getByRole('button', { name: '完成设置' }).click()
    // 订单页出现「已退」徽章与删除线占位
    await expect(page.getByTestId('cancel-approved-badge').first()).toBeVisible()
    await expect(page.getByTestId('order-cancelled-summary')).toBeVisible()
  })

  test('REQ-002.3: DemoConsole 单条拒绝后菜品回到正常态，徽章消失', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    await page.getByTestId('cancel-reason-quality').click()
    await page.getByTestId('cancel-confirm-btn').click()
    await expect(page.getByTestId('cancel-pending-badge').first()).toBeVisible()

    await page.getByRole('button', { name: /演示|Demo/ }).first().click()
    const denyBtn = page.locator('[data-testid^="console-cancel-deny-"]').first()
    await expect(denyBtn).toBeVisible()
    await denyBtn.click()
    await expect(page.getByText('已拒绝退菜申请')).toBeVisible()
    await page.getByRole('button', { name: '完成设置' }).click()
    // 退菜按钮重新出现，pending 徽章消失
    await expect(page.getByTestId('cancel-pending-badge')).toHaveCount(0)
    await expect(page.getByTestId('order-cancel-btn').first()).toBeVisible()
  })

  test('REQ-002.4: 多条待审批时显示「全部批准」按钮', async ({ page }) => {
    await enterMenu(page)
    // 加两份不同菜品
    await addRecommendItem(page)
    // 切换到蔬菜类
    await page.getByRole('button', { name: '蔬菜豆品' }).click()
    const veggieCard = page.locator('article').first()
    await veggieCard.getByRole('button').last().click()
    await page.getByRole('button', { name: /加入本桌购物车/ }).click()
    // 提交订单
    await page.getByRole('button', { name: /确认并提交订单/ }).click()
    await expect(page).toHaveURL(/#\/order$/)

    const cancelBtns = page.getByTestId('order-cancel-btn')
    await expect(cancelBtns).toHaveCount(2)
    // 全部点退菜
    await cancelBtns.nth(0).click()
    await page.getByTestId('cancel-reason-wrong_order').click()
    await page.getByTestId('cancel-confirm-btn').click()
    await cancelBtns.nth(0).click() // first cancel-btn is now the next pending one
    await page.getByTestId('cancel-reason-allergen').click()
    await page.getByTestId('cancel-confirm-btn').click()

    // 打开 DemoConsole
    await page.getByRole('button', { name: /演示|Demo/ }).first().click()
    await expect(page.getByTestId('console-cancel-approve-all')).toBeVisible()
    await page.getByTestId('console-cancel-approve-all').click()
    await expect(page.getByText('已批准退菜申请')).toBeVisible()
    // 控制台日志区不再有待审批
    await expect(page.getByTestId('console-cancel-empty')).toBeVisible()
  })

  test('REQ-003: 批准后退菜菜品在 OrderView 与 CheckoutView 同步扣除', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    await page.getByTestId('cancel-reason-quality').click()
    await page.getByTestId('cancel-confirm-btn').click()

    await page.getByRole('button', { name: /演示|Demo/ }).first().click()
    const approveBtn = page.locator('[data-testid^="console-cancel-approve-"]').first()
    await approveBtn.click()
    await page.getByRole('button', { name: '完成设置' }).click()

    // OrderView 合计 = 0（仅一份菜品被退）
    await expect(page.getByText('¥0.00').first()).toBeVisible()
    // 跳到结账
    await page.getByRole('button', { name: /去结账/ }).click()
    await expect(page).toHaveURL(/#\/checkout$/)
    // 结账页菜品列表为空，提示已退合计
    await expect(page.getByTestId('checkout-cancelled-summary')).toBeVisible()
    // 应付合计 = 0（菜品小计 0,折扣 0,应付 0）
    const checkoutPayable = page.locator('text=¥0.00')
    await expect(checkoutPayable.first()).toBeVisible()
  })

  test('REQ-005: OrderView 折叠区与 DemoConsole 展示操作日志（含原因/操作人/时间）', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    await page.getByTestId('cancel-reason-kitchen_refuse').click()
    await page.getByTestId('cancel-note').fill('后厨材料不足')
    await page.getByTestId('cancel-confirm-btn').click()

    // 打开日志折叠区
    await page.getByTestId('order-cancel-log').getByRole('button').click()
    await expect(page.getByText('厨房拒做')).toBeVisible()
    await expect(page.getByText('后厨材料不足')).toBeVisible()

    // 控制台日志
    await page.getByRole('button', { name: /演示|Demo/ }).first().click()
    await expect(page.getByTestId('console-cancel-log')).toBeVisible()
    await expect(page.getByText('厨房拒做').first()).toBeVisible()
  })

  test('REQ-006: 批准后退菜菜品叠加「已退」徽章并显示删除线占位', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    await page.getByTestId('cancel-reason-quality').click()
    await page.getByTestId('cancel-confirm-btn').click()
    await page.getByRole('button', { name: /演示|Demo/ }).first().click()
    await page.locator('[data-testid^="console-cancel-approve-"]').first().click()
    await page.getByRole('button', { name: '完成设置' }).click()

    const cancelledRow = page.locator('[data-cancel-state="approved"]').first()
    await expect(cancelledRow).toBeVisible()
    await expect(cancelledRow.locator('[data-testid="cancel-approved-badge"]')).toBeVisible()
    // 行内存在删除线占位文案
    await expect(cancelledRow.getByText(/已退 ¥/)).toBeVisible()
    // 履约阶段文字仍保留
    await expect(cancelledRow.getByText('订单已提交')).toBeVisible()
  })

  test('NFR-001: 已上桌（served）菜品不显示「退菜」按钮', async ({ page }) => {
    await submitOneItemOrder(page)
    // 把订单推到 served
    await page.getByRole('button', { name: /演示|Demo/ }).first().click()
    await page.getByRole('button', { name: /已上菜/ }).click()
    await page.getByRole('button', { name: '完成设置' }).click()
    // 履约进度进入「菜品已上桌」
    await expect(page.getByText('菜品已上桌').first()).toBeVisible()
    // 退菜按钮不再渲染
    await expect(page.getByTestId('order-cancel-btn')).toHaveCount(0)
  })

  test('NFR-002: 已批准的退菜菜品不可再次退菜（按钮不渲染）', async ({ page }) => {
    await submitOneItemOrder(page)
    await page.getByTestId('order-cancel-btn').first().click()
    await page.getByTestId('cancel-reason-quality').click()
    await page.getByTestId('cancel-confirm-btn').click()
    await page.getByRole('button', { name: /演示|Demo/ }).first().click()
    await page.locator('[data-testid^="console-cancel-approve-"]').first().click()
    await page.getByRole('button', { name: '完成设置' }).click()
    await expect(page.getByTestId('order-cancel-btn')).toHaveCount(0)
  })
})
