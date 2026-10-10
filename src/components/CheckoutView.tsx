import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, CheckCircle2, CreditCard, Gift, MessageCircleQuestion, ReceiptText, RotateCcw, ShieldCheck, Smartphone, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AaPayDialog } from '@/components/AaPayDialog'
import { useCountdown } from '@/hooks/useCountdown'
import { centsToYuan, money, moneyCents, type Cents } from '@/lib/utils'
import type { AaMode, AaRefundLog, AaSession, AaSubOrder, OrderItem } from '@/types'

interface CheckoutViewProps {
  items: OrderItem[]
  paid: boolean
  diners: string[]
  aaSession?: AaSession
  aaRefundLogs: AaRefundLog[]
  onPay: () => void
  onBack: () => void
  onAaCreate: (input: {
    diners: string[]
    mode: AaMode
    payableCents: number
    timeoutMs: number
    ratioInputs?: Record<string, number>
    customInputs?: Record<string, number>
  }) => void
  onAaPaySubOrder: (sessionId: string, diner: string) => void
  onAaExpireSubOrder: (sessionId: string, diner: string) => void
  onAaCancelAll: (sessionId: string) => void
  onAaRefundSubOrder: (sessionId: string, diner: string, note?: string) => void
  onAaReissueSubOrder: (sessionId: string, diner: string) => void
}

const DEFAULT_TIMEOUT_MS = 1_800_000 // 30 min

export function CheckoutView({
  items,
  paid,
  diners,
  aaSession,
  aaRefundLogs,
  onPay,
  onBack,
  onAaCreate,
  onAaPaySubOrder,
  onAaExpireSubOrder,
  onAaCancelAll,
  onAaRefundSubOrder,
  onAaReissueSubOrder,
}: CheckoutViewProps) {
  const { t } = useTranslation()
  const [method, setMethod] = useState('mobile')
  const [aaPanelOpen, setAaPanelOpen] = useState(false)
  const [aaMode, setAaMode] = useState<AaMode>('equal')
  const [aaRatioInputs, setAaRatioInputs] = useState<Record<string, number>>(() => Object.fromEntries(diners.map((d) => [d, 0])))
  const [aaCustomInputs, setAaCustomInputs] = useState<Record<string, string>>(() => Object.fromEntries(diners.map((d) => [d, ''])))

  // 邀请卡 Dialog 状态
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [payDialogDiner, setPayDialogDiner] = useState<string | null>(null)
  // 关闭二次确认状态
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  // 取消 AA 二次确认
  const [cancelAllConfirmOpen, setCancelAllConfirmOpen] = useState(false)
  // 退款二次确认
  const [refundConfirmDiner, setRefundConfirmDiner] = useState<string | null>(null)
  // 凑不齐人 / 应付为 0 时显示在按钮旁的 tooltip
  const [aaEntryHint, setAaEntryHint] = useState<string | null>(null)

  const billable = useMemo(() => items.filter((item) => item.cancelState !== 'approved'), [items])
  const subtotal = billable.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const discount = subtotal >= 100 ? 30 : 0
  const payable = subtotal - discount
  const payableCents: Cents = moneyCents(payable)

  // 当 diners 变化（例如重置）时，同步刷新拆分输入草稿
  useEffect(() => {
    setAaRatioInputs((prev) => {
      const next: Record<string, number> = {}
      for (const d of diners) next[d] = prev[d] ?? 0
      return next
    })
    setAaCustomInputs((prev) => {
      const next: Record<string, string> = {}
      for (const d of diners) next[d] = prev[d] ?? ''
      return next
    })
    // 等额时不需要草稿，但保留字段；equal 下我们不需要 ratioInputs/customInputs
  }, [diners])

  const aaEnabled = !aaSession && diners.length >= 2 && payableCents > 0 && !paid
  const aaHintKey = !aaSession && !paid
    ? (diners.length < 2 ? 'checkout.aa_disabled_too_few' : payableCents === 0 ? 'checkout.aa_disabled_no_amount' : null)
    : null

  // 倒计时：始终订阅 aaSession；卸载 / 会话清空 / 子单不再 pending 时 cleanup
  const countdown = useCountdown(aaSession, (diner) => {
    if (aaSession) onAaExpireSubOrder(aaSession.id, diner)
  })
  // 在 useMemo 里依赖 tick 触发重渲染（即使没变化也要消费一次，否则 hook 内 setInterval 不会触发组件更新）
  void countdown._tick

  // 拆分校验（拆分面板本地态）
  const ratioSum = diners.reduce((acc, d) => acc + Math.max(0, Math.floor(aaRatioInputs[d] ?? 0)), 0)
  const customSumCents = diners.reduce((acc, d) => acc + moneyCents(parseFloat(aaCustomInputs[d] ?? '') || 0), 0)
  const customAllPositive = diners.every((d) => moneyCents(parseFloat(aaCustomInputs[d] ?? '') || 0) > 0)

  const splitValid = (() => {
    if (aaMode === 'equal') return diners.length >= 2 && payableCents > 0
    if (aaMode === 'ratio') return ratioSum === 100
    if (aaMode === 'custom') return customSumCents === payableCents && customAllPositive
    return false
  })()

  const handleConfirmSplit = () => {
    if (!splitValid) return
    const base = { diners, mode: aaMode as AaMode, payableCents, timeoutMs: aaSession?.timeoutMs ?? DEFAULT_TIMEOUT_MS }
    if (aaMode === 'equal') {
      onAaCreate(base)
    } else if (aaMode === 'ratio') {
      onAaCreate({ ...base, ratioInputs: { ...aaRatioInputs } })
    } else {
      const customInputs: Record<string, number> = {}
      for (const d of diners) customInputs[d] = moneyCents(parseFloat(aaCustomInputs[d] ?? '') || 0)
      onAaCreate({ ...base, customInputs })
    }
    setAaPanelOpen(false)
  }

  const handleOpenCard = (diner: string) => {
    if (!aaSession) return
    const sub = aaSession.subOrders.find((s) => s.diner === diner)
    if (!sub) return
    if (sub.status !== 'pending') return // 已支付 / 过期 / 取消 / 退款：不开 Dialog
    setPayDialogDiner(diner)
    setPayDialogOpen(true)
  }

  const handlePayDialogOpenChange = (next: boolean) => {
    if (!next && payDialogOpen) {
      // 用户尝试关闭 → 弹出二次确认
      setCloseConfirmOpen(true)
      return
    }
    setPayDialogOpen(next)
    if (!next) setPayDialogDiner(null)
  }

  const handleAbandon = () => {
    // 不修改任何 reducer state；仅关闭 Dialog
  }

  const handlePayConfirm = () => {
    if (!aaSession || !payDialogDiner) return
    onAaPaySubOrder(aaSession.id, payDialogDiner)
  }

  const handleCancelAll = () => {
    if (!aaSession) return
    onAaCancelAll(aaSession.id)
    setCancelAllConfirmOpen(false)
  }

  const handleRefund = (diner: string) => {
    if (!aaSession) return
    onAaRefundSubOrder(aaSession.id, diner)
    setRefundConfirmDiner(null)
  }

  const handleReissue = (diner: string) => {
    if (!aaSession) return
    onAaReissueSubOrder(aaSession.id, diner)
  }

  const isPaid = paid
  if (isPaid) {
    const allDoneByAa = !!aaSession && aaSession.subOrders.every((s) => s.status === 'paid')
    const refundCount = aaRefundLogs.length
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-10">
        <section className="w-full rounded-3xl bg-white p-7 text-center shadow-float">
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check size={36} /></span>
          <p className="mt-6 text-sm font-bold text-emerald-600">{t('checkout.success_badge')}</p>
          <h1 className="mt-2 text-3xl font-extrabold text-charcoal-900">{t('checkout.success_title')}</h1>
          {allDoneByAa && (
            <p data-testid="aa-all-done-note" className="mt-3 text-sm font-semibold text-chili-500">{t('checkout.aa_all_done_note')}</p>
          )}
          <p className="mt-3 whitespace-pre-line leading-7 text-charcoal-500">{t('checkout.success_desc')}</p>
          <div className="mt-6 rounded-2xl bg-rice-100 p-4">
            <p className="text-sm text-charcoal-500">{t('checkout.paid')}</p>
            <p className="mt-1 text-3xl font-extrabold text-chili-500">{money(payable)}</p>
          </div>
          {refundCount > 0 && (
            <p data-testid="aa-refunded-progress" className="mt-3 text-xs text-amber-500">{t('checkout.aa_refund_progress', { count: refundCount })}</p>
          )}
          <Button onClick={onBack} variant="outline" className="mt-6 w-full">{t('checkout.back')}</Button>
        </section>
      </main>
    )
  }

  const methods = [
    { id: 'mobile', name: t('checkout.method_mobile'), icon: Smartphone, note: t('checkout.method_mobile_note') },
    { id: 'pos', name: t('checkout.method_pos'), icon: CreditCard, note: t('checkout.method_pos_note') },
  ]

  const renderBill = () => (
    <section className="rounded-3xl bg-white p-5 shadow-card lg:col-span-3">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-chili-50 p-3 text-chili-500"><ReceiptText /></span><div><p className="text-xs font-bold text-chili-500">{t('checkout.badge')}</p><h1 className="text-2xl font-extrabold text-charcoal-900">{t('checkout.title')}</h1></div></div>
      <div className="mt-6 space-y-3">
        {billable.map((item) => (
          <div key={item.uid} className="flex justify-between text-sm">
            <span className="text-charcoal-700">{item.name} <small className="text-charcoal-500">× {item.quantity}</small></span>
            <span className="font-semibold text-charcoal-900">{money(item.price * item.quantity)}</span>
          </div>
        ))}
        {items.length > billable.length && (
          <div data-testid="checkout-cancelled-summary" className="mt-2 rounded-xl bg-charcoal-900/5 px-3 py-2 text-xs text-charcoal-500">
            {t('order.cancelled_price', { amount: money(items.filter((item) => item.cancelState === 'approved').reduce((sum, item) => sum + item.price * item.quantity, 0)) })}
          </div>
        )}
      </div>
      <div className="mt-5 border-t border-dashed border-charcoal-900/10 pt-4">
        <div className="flex justify-between text-sm text-charcoal-500"><span>{t('checkout.subtotal')}</span><span>{money(subtotal)}</span></div>
        {discount > 0 && (
          <div className="mt-3 flex justify-between text-sm text-chili-500"><span className="flex items-center gap-2"><Gift size={15} />{t('checkout.discount')}</span><span>-{money(discount)}</span></div>
        )}
        <div className="mt-4 flex items-end justify-between text-charcoal-900"><strong>{t('checkout.payable')}</strong><strong className="text-3xl text-chili-500">{money(payable)}</strong></div>
      </div>
    </section>
  )

  // AA 会话存在时，整片隐藏原「选择支付方式」；否则渲染原卡片
  const aaView = aaSession

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 lg:py-10">
      <button onClick={onBack} className="mb-5 text-sm font-bold text-charcoal-500 hover:text-chili-500">← {t('checkout.back')}</button>
      <div className="grid gap-5 lg:grid-cols-5">
        {renderBill()}
        <section className="rounded-3xl bg-white p-5 shadow-card lg:col-span-2" data-testid="checkout-aa-entry-wrap">
          <div className="flex items-center gap-3"><span className="rounded-xl bg-chili-50 p-3 text-chili-500"><Users /></span><div><p className="text-xs font-bold text-chili-500">{t('checkout.badge')}</p><h2 className="text-lg font-extrabold text-charcoal-900">{t('checkout.aa_section_title')}</h2></div></div>
          {aaView ? (
            <AaSessionPanel
              session={aaView}
              aaRefundLogs={aaRefundLogs}
              countdown={countdown}
              onOpenCard={handleOpenCard}
              onCancelAll={() => setCancelAllConfirmOpen(true)}
              onRefund={(diner) => setRefundConfirmDiner(diner)}
              onReissue={handleReissue}
            />
          ) : (
            <div className="mt-4">
              {subtotal >= 100 && discount > 0 && (
                <p data-testid="checkout-aa-coupon-note" className="mb-3 rounded-xl bg-amber-100/70 px-3 py-2 text-xs text-amber-500">{t('checkout.aa_coupon_used', { amount: money(discount) })}</p>
              )}
              {!aaPanelOpen ? (
                <Button
                  data-testid="checkout-aa-entry"
                  disabled={!aaEnabled}
                  onClick={() => setAaPanelOpen(true)}
                  onMouseEnter={() => aaHintKey && setAaEntryHint(aaHintKey)}
                  onMouseLeave={() => setAaEntryHint(null)}
                  className="w-full"
                >
                  <Users size={17} />{t('checkout.aa_entry')}
                </Button>
              ) : (
                <div data-testid="checkout-aa-panel" className="mt-3 space-y-3 rounded-2xl border border-charcoal-900/10 bg-rice-50 p-3">
                  <div className="flex gap-2" role="tablist" aria-label="AA mode">
                    {(['equal', 'ratio', 'custom'] as AaMode[]).map((m) => (
                      <button
                        key={m}
                        role="tab"
                        aria-selected={aaMode === m}
                        data-testid={`checkout-aa-mode-${m}`}
                        onClick={() => setAaMode(m)}
                        className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition ${aaMode === m ? 'bg-chili-500 text-white' : 'bg-white text-charcoal-500 border border-charcoal-900/10'}`}
                      >
                        {t(`checkout.aa_mode_${m}`)}
                      </button>
                    ))}
                  </div>
                  {aaMode === 'equal' && (
                    <p className="text-xs text-charcoal-500">{t('checkout.aa_mode_equal')} · {diners.length} {t('cart.people', { count: diners.length })}</p>
                  )}
                  {aaMode === 'ratio' && (
                    <div className="space-y-2">
                      {diners.map((d) => (
                        <div key={d} className="flex items-center gap-2">
                          <span className="flex-1 text-sm text-charcoal-700">{d}</span>
                          <input
                            data-testid={`checkout-aa-ratio-${d}`}
                            type="number"
                            min={0}
                            max={100}
                            value={aaRatioInputs[d] ?? 0}
                            onChange={(e) => setAaRatioInputs({ ...aaRatioInputs, [d]: Number(e.target.value) || 0 })}
                            className="w-20 rounded-xl border border-charcoal-900/10 bg-white px-3 py-2 text-right text-sm"
                          />
                          <span className="text-xs text-charcoal-500">%</span>
                        </div>
                      ))}
                      <p data-testid="checkout-aa-ratio-sum" className={`text-xs ${ratioSum === 100 ? 'text-emerald-600' : 'text-chili-500'}`}>Σ = {ratioSum}</p>
                    </div>
                  )}
                  {aaMode === 'custom' && (
                    <div className="space-y-2">
                      {diners.map((d) => (
                        <div key={d} className="flex items-center gap-2">
                          <span className="flex-1 text-sm text-charcoal-700">{d}</span>
                          <span className="text-xs text-charcoal-500">¥</span>
                          <input
                            data-testid={`checkout-aa-custom-${d}`}
                            type="number"
                            inputMode="decimal"
                            min={0.01}
                            step={0.01}
                            value={aaCustomInputs[d] ?? ''}
                            onChange={(e) => setAaCustomInputs({ ...aaCustomInputs, [d]: e.target.value })}
                            className="w-24 rounded-xl border border-charcoal-900/10 bg-white px-3 py-2 text-right text-sm"
                          />
                        </div>
                      ))}
                      <p data-testid="checkout-aa-custom-sum" className={`text-xs ${customSumCents === payableCents && customAllPositive ? 'text-emerald-600' : 'text-chili-500'}`}>
                        Σ = {(customSumCents / 100).toFixed(2)} / {payable.toFixed(2)}
                      </p>
                    </div>
                  )}
                  <Button data-testid="checkout-aa-confirm" disabled={!splitValid} onClick={handleConfirmSplit} className="w-full">
                    <Check size={17} />{t('checkout.aa_confirm_split')}
                  </Button>
                  <Button variant="outline" onClick={() => setAaPanelOpen(false)} className="w-full">
                    <X size={17} />{t('common.back')}
                  </Button>
                </div>
              )}
              {aaEntryHint && (
                <p data-testid="checkout-aa-entry-hint" className="mt-2 text-xs text-chili-500">{t(aaEntryHint)}</p>
              )}
            </div>
          )}
        </section>
        {!aaView && (
          <section className="rounded-3xl bg-white p-5 shadow-card lg:col-span-5">
            <h2 className="font-extrabold text-charcoal-900">{t('checkout.select_method')}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">{methods.map(({ id, name, icon: Icon, note }) => <button key={id} onClick={() => setMethod(id)} className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition ${method === id ? 'border-chili-500 bg-chili-50' : 'border-charcoal-900/5 bg-rice-50'}`}><span className="rounded-xl bg-white p-2 text-chili-500"><Icon size={20} /></span><span className="flex-1"><strong className="block text-sm text-charcoal-900">{name}</strong><small className="text-charcoal-500">{note}</small></span>{method === id && <Check size={18} className="text-chili-500" />}</button>)}</div>
            <Button onClick={onPay} className="mt-5 w-full"><ShieldCheck size={17} />{t('checkout.confirm_pay', { amount: money(payable) })}</Button>
            <button className="mt-4 flex w-full items-center justify-center gap-2 text-xs font-semibold text-charcoal-500"><MessageCircleQuestion size={14} />{t('checkout.question')}</button>
          </section>
        )}
      </div>

      {/* AaPayDialog */}
      {aaSession && payDialogDiner && (
        <AaPayDialog
          open={payDialogOpen}
          onOpenChange={handlePayDialogOpenChange}
          session={aaSession}
          diner={payDialogDiner}
          amountCents={aaSession.subOrders.find((s) => s.diner === payDialogDiner)?.amountCents ?? 0}
          items={billable}
          onPay={handlePayConfirm}
          onAbandon={handleAbandon}
        />
      )}

      {/* Dialog 关闭二次确认 */}
      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent title={t('checkout.aa_already_paid')}>
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3 rounded-2xl bg-amber-100/70 p-3">
              <span className="rounded-full bg-white p-2 text-amber-500"><AlertTriangle size={18} /></span>
              <p className="text-sm leading-6 text-charcoal-700">{t('checkout.aa_dialog_close_confirm')}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                data-testid="aa-dialog-close-confirm"
                onClick={() => { setPayDialogOpen(false); setPayDialogDiner(null); setCloseConfirmOpen(false) }}
              >
                <Check size={17} />{t('checkout.aa_pay_abandon')}
              </Button>
              <Button variant="outline" onClick={() => setCloseConfirmOpen(false)}>
                <X size={17} />{t('common.back')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 取消 AA 二次确认 */}
      <Dialog open={cancelAllConfirmOpen} onOpenChange={setCancelAllConfirmOpen}>
        <DialogContent title={t('checkout.aa_cancel_all')}>
          <div className="mt-4 space-y-4">
            <p className="text-sm leading-6 text-charcoal-700">{t('checkout.aa_cancel_confirm')}</p>
            <div className="flex justify-end gap-2">
              <Button data-testid="aa-cancel-all" onClick={handleCancelAll}>
                <Check size={17} />{t('checkout.aa_cancel_all')}
              </Button>
              <Button data-testid="aa-cancel-confirm" variant="outline" onClick={() => setCancelAllConfirmOpen(false)}>
                <X size={17} />{t('common.back')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 单子单退款二次确认 */}
      <Dialog open={refundConfirmDiner !== null} onOpenChange={(o) => !o && setRefundConfirmDiner(null)}>
        <DialogContent title={t('checkout.aa_refund_one', { name: refundConfirmDiner ?? '' })}>
          <div className="mt-4 space-y-4">
            <p className="text-sm leading-6 text-charcoal-700">
              {t('checkout.aa_refund_confirm', {
                name: refundConfirmDiner ?? '',
                amount: aaSession && refundConfirmDiner ? money(centsToYuan(aaSession.subOrders.find((s) => s.diner === refundConfirmDiner)?.amountCents ?? 0)) : '',
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                data-testid={`aa-refund-confirm-${refundConfirmDiner ?? ''}`}
                onClick={() => refundConfirmDiner && handleRefund(refundConfirmDiner)}
              >
                <Check size={17} />{t('checkout.aa_refund_one', { name: '' })}
              </Button>
              <Button variant="outline" onClick={() => setRefundConfirmDiner(null)}>
                <X size={17} />{t('common.back')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}

/** AA 会话展示面板：聚合视图 + 邀请卡列表 + 取消/退款/重发入口 */
function AaSessionPanel({
  session,

  aaRefundLogs,
  countdown,
  onOpenCard,
  onCancelAll,
  onRefund,
  onReissue,
}: {
  session: AaSession
  aaRefundLogs: AaRefundLog[]
  countdown: ReturnType<typeof useCountdown>
  onOpenCard: (diner: string) => void
  onCancelAll: () => void
  onRefund: (diner: string) => void
  onReissue: (diner: string) => void
}) {
  const { t } = useTranslation()
  const total = session.subOrders.length
  const paidCount = session.subOrders.filter((s) => s.status === 'paid').length
  const expiredCount = session.subOrders.filter((s) => s.status === 'expired').length
  const cancelledCount = session.subOrders.filter((s) => s.status === 'cancelled').length
  const refundedCount = session.subOrders.filter((s) => s.status === 'refunded').length
  const pendingCount = session.subOrders.filter((s) => s.status === 'pending').length
  const totalCents = session.subOrders.reduce((acc, s) => acc + s.amountCents, 0)
  const paidCents = session.subOrders.filter((s) => s.status === 'paid').reduce((acc, s) => acc + s.amountCents, 0)
  const canCancel = pendingCount + expiredCount > 0

  return (
    <div className="mt-4 space-y-4" data-testid="aa-session-panel">
      <div data-testid="aa-progress" className="rounded-2xl bg-rice-50 p-4">
        <p className="text-xs font-bold text-chili-500">{t('checkout.aa_progress')}</p>
        <div className="mt-2 flex items-end justify-between">
          <strong className="text-2xl text-charcoal-900">{paidCount}/{total}</strong>
          <span className="text-xs text-charcoal-500">{money(centsToYuan(paidCents))} / {money(centsToYuan(totalCents))}</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-charcoal-900/10">
          <div className="h-full bg-chili-500 transition-all" style={{ width: total > 0 ? `${(paidCount / total) * 100}%` : '0%' }} />
        </div>
        {expiredCount > 0 && (
          <p data-testid="aa-expired-note" className="mt-2 text-xs text-chili-500">{t('checkout.aa_expired_count', { count: expiredCount })}</p>
        )}
        {refundedCount > 0 && (
          <p data-testid="aa-refund-note" className="mt-2 text-xs text-amber-500">{t('checkout.aa_refund_progress', { count: refundedCount })}</p>
        )}
        {cancelledCount > 0 && pendingCount === 0 && paidCount === 0 && expiredCount === 0 && (
          <p data-testid="aa-cancelled-note" className="mt-2 text-xs text-charcoal-500">{t('checkout.aa_status_cancelled')}</p>
        )}
      </div>

      <div className="space-y-2" data-testid="aa-card-list">
        {session.subOrders.map((sub) => (
          <AaCard key={sub.diner} sub={sub} countdown={countdown} onOpen={onOpenCard} onRefund={onRefund} onReissue={onReissue} />
        ))}
      </div>

      <div data-testid="aa-refund-log" className="rounded-2xl bg-rice-50 p-3">
        <p className="text-xs font-bold text-charcoal-700">{t('console.aa_refund_log_title')}</p>
        {aaRefundLogs.length === 0 ? (
          <p className="mt-2 text-xs text-charcoal-500">{t('console.aa_refund_log_empty')}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {aaRefundLogs.slice(-3).reverse().map((log) => (
              <li key={log.id} className="rounded-lg bg-white px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <strong className="text-charcoal-900">{log.diner}</strong>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-500">{money(centsToYuan(log.amountCents))}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canCancel && (
        <Button variant="outline" data-testid="aa-cancel-entry" onClick={onCancelAll} className="w-full">
          <X size={17} />{t('checkout.aa_cancel_all')}
        </Button>
      )}
    </div>
  )
}

function AaCard({
  sub,
  countdown,
  onOpen,
  onRefund,
  onReissue,
}: {
  sub: AaSubOrder
  countdown: ReturnType<typeof useCountdown>
  onOpen: (diner: string) => void
  onRefund: (diner: string) => void
  onReissue: (diner: string) => void
}) {
  const { t } = useTranslation()
  const isPaid = sub.status === 'paid'
  const isExpired = sub.status === 'expired'
  const isCancelled = sub.status === 'cancelled'
  const isRefunded = sub.status === 'refunded'
  const isPending = sub.status === 'pending'
  const remaining = countdown.remainingMs(sub.diner)
  const formatted = countdown.formatted(sub.diner)
  const cardBase = 'block w-full rounded-3xl bg-white p-5 text-left shadow-card transition'

  if (isPaid) {
    return (
      <div data-testid={`aa-card-${sub.diner}`} className={`${cardBase} bg-emerald-50`}>
        <div className="flex items-center justify-between">
          <strong className="text-charcoal-900">{sub.diner}</strong>
          <span className="flex items-center gap-1 text-xs font-bold text-emerald-600"><CheckCircle2 size={14} />{t('checkout.aa_status_paid')}</span>
        </div>
        <p className="mt-2 text-2xl font-extrabold text-emerald-600">{money(centsToYuan(sub.amountCents))}</p>
        <button
          data-testid={`aa-refund-${sub.diner}`}
          onClick={() => onRefund(sub.diner)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-amber-500"
        >
          <RotateCcw size={14} />{t('checkout.aa_refund_one', { name: '' })}
        </button>
      </div>
    )
  }
  if (isExpired) {
    return (
      <div data-testid={`aa-card-${sub.diner}`} className={`${cardBase} border border-charcoal-900/10`}>
        <div className="flex items-center justify-between">
          <strong className="text-charcoal-500">{sub.diner}</strong>
          <span className="text-xs font-bold text-charcoal-500">{t('checkout.aa_status_expired')}</span>
        </div>
        <p className="mt-2 text-2xl font-extrabold text-charcoal-500">{money(centsToYuan(sub.amountCents))}</p>
        <p className="mt-2 text-xs text-charcoal-500">{formatted}</p>
        <button
          data-testid={`aa-reissue-${sub.diner}`}
          onClick={() => onReissue(sub.diner)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-chili-500"
        >
          <RotateCcw size={14} />{t('checkout.aa_reissue')}
        </button>
      </div>
    )
  }
  if (isCancelled) {
    return (
      <div data-testid={`aa-card-${sub.diner}`} className={`${cardBase} border border-charcoal-900/10`}>
        <div className="flex items-center justify-between">
          <strong className="text-charcoal-500 line-through">{sub.diner}</strong>
          <span className="text-xs font-bold text-charcoal-500">{t('checkout.aa_status_cancelled')}</span>
        </div>
        <p className="mt-2 text-2xl font-extrabold text-charcoal-500 line-through">{money(centsToYuan(sub.amountCents))}</p>
      </div>
    )
  }
  if (isRefunded) {
    return (
      <div data-testid={`aa-card-${sub.diner}`} className={`${cardBase} border border-charcoal-900/10`}>
        <div className="flex items-center justify-between">
          <strong className="text-charcoal-500">{sub.diner}</strong>
          <span className="text-xs font-bold text-amber-500">{t('checkout.aa_status_refunded')}</span>
        </div>
        <p className="mt-2 text-2xl font-extrabold text-amber-500">{money(centsToYuan(sub.amountCents))}</p>
      </div>
    )
  }
  // pending
  return (
    <button
      data-testid={`aa-card-${sub.diner}`}
      onClick={() => onOpen(sub.diner)}
      className={`${cardBase} hover:border-chili-500/40 hover:shadow-float`}
    >
      <div className="flex items-center justify-between">
        <strong className="text-charcoal-900">{sub.diner}</strong>
        <span className="text-xs font-bold text-chili-500">{t('checkout.aa_status_pending')}</span>
      </div>
      <p className="mt-2 text-2xl font-extrabold text-chili-500">{money(centsToYuan(sub.amountCents))}</p>
      <p className="mt-2 text-xs text-charcoal-500">{formatted} · {isPending ? remaining > 0 ? '' : '00:00' : '00:00'}</p>
    </button>
  )
}
