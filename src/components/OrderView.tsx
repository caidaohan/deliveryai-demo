import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChefHat, ChevronDown, ChevronRight, ChevronUp, Clock3, Plus, ReceiptText, RotateCcw, UtensilsCrossed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { money } from '@/lib/utils'
import type { CancelLog, CancelReason, OrderItem, OrderStage } from '@/types'

const stageIcons: Record<OrderStage, typeof Check> = {
  submitted: ReceiptText,
  accepted: Check,
  cooking: ChefHat,
  served: UtensilsCrossed,
}
const stageKeys: OrderStage[] = ['submitted', 'accepted', 'cooking', 'served']
const rank: Record<OrderStage, number> = { submitted: 0, accepted: 1, cooking: 2, served: 3 }

const reasonKeys: CancelReason[] = ['wrong_order', 'wrong_dish', 'quality', 'allergen', 'soldout_late', 'kitchen_refuse', 'other']

interface OrderViewProps {
  items: OrderItem[]
  stage: OrderStage
  logs: CancelLog[]
  onRequestCancel: (uid: string, reason: CancelReason, note?: string) => void
  onAddMore: () => void
  onCheckout: () => void
}

export function OrderView({ items, stage, logs, onRequestCancel, onAddMore, onCheckout }: OrderViewProps) {
  const { t } = useTranslation()
  const [cancelTarget, setCancelTarget] = useState<OrderItem | null>(null)
  const [reason, setReason] = useState<CancelReason | ''>('')
  const [note, setNote] = useState('')
  const [logsExpanded, setLogsExpanded] = useState(false)

  const total = items.filter((item) => item.cancelState !== 'approved').reduce((sum, item) => sum + item.price * item.quantity, 0)
  const approvedSum = useMemo(
    () => items.filter((item) => item.cancelState === 'approved').reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items],
  )

  const openCancelDialog = (item: OrderItem) => {
    setCancelTarget(item)
    setReason('')
    setNote('')
  }

  const closeCancelDialog = () => {
    setCancelTarget(null)
    setReason('')
    setNote('')
  }

  const submitCancel = () => {
    if (!cancelTarget || !reason) return
    if (reason === 'other' && note.trim().length === 0) return
    onRequestCancel(cancelTarget.uid, reason, note || undefined)
    closeCancelDialog()
  }

  const orderLogs = useMemo(() => {
    const uids = new Set(items.map((item) => item.uid))
    return logs.filter((log) => uids.has(log.orderItemUid))
  }, [items, logs])

  if (!items.length) return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center"><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-chili-500 shadow-card"><ReceiptText size={28} /></span><h2 className="mt-5 text-2xl font-extrabold text-charcoal-900">{t('order.empty_title')}</h2><p className="mt-2 text-charcoal-500">{t('order.empty_desc')}</p><Button onClick={onAddMore} className="mt-6"><Plus size={17} />{t('order.start')}</Button></main>
  )

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6 lg:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold text-chili-500">{t('order.badge')}</p><h1 className="mt-1 text-3xl font-extrabold text-charcoal-900">{t('order.title')}</h1></div><Button variant="outline" onClick={onAddMore}><Plus size={17} />{t('order.add_more')}</Button></div>
      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <section className="rounded-3xl bg-charcoal-900 p-5 text-white shadow-card lg:col-span-2">
          <div className="flex items-center justify-between"><h2 className="font-bold">{t('order.progress')}</h2><span className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs text-amber-400"><Clock3 size={13} />{t('order.realtime')}</span></div>
          <div className="mt-6 space-y-1">
            {stageKeys.map((id, index) => {
              const active = index <= rank[stage]
              const Icon = stageIcons[id]
              return <div key={id} className="relative flex gap-4 pb-7 last:pb-0">{index < stageKeys.length - 1 && <span className={`absolute left-4 top-8 h-full w-px ${active && index < rank[stage] ? 'bg-amber-400' : 'bg-white/15'}`} />}<span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${active ? 'bg-amber-400 text-charcoal-900' : 'bg-white/10 text-white/40'}`}><Icon size={15} /></span><div><p className={`font-bold ${active ? 'text-white' : 'text-white/40'}`}>{t(`order.stage.${id}.label`)}</p><p className={`mt-1 text-xs ${active ? 'text-rice-200' : 'text-white/30'}`}>{active ? t(`order.stage.${id}.note`) : t('order.waiting')}</p></div></div>
            })}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-card lg:col-span-3">
          <div className="flex items-center justify-between"><div><h2 className="text-lg font-extrabold text-charcoal-900">{t('order.items_title')}</h2><p className="mt-1 text-xs text-charcoal-500">{t('order.order_no')}</p></div><span className="rounded-full bg-chili-50 px-3 py-1 text-xs font-bold text-chili-600">{t('order.item_count', { count: items.length })}</span></div>
          <div className="mt-5 space-y-4">
            {items.map((item) => {
              const isCancelled = item.cancelState === 'approved'
              const isRequested = item.cancelState === 'requested'
              const cancellable = !item.cancelState && item.stage !== 'served'
              return (
                <div
                  key={item.uid}
                  data-cancel-state={item.cancelState ?? 'none'}
                  className={`flex gap-3 border-b border-charcoal-900/5 pb-4 last:border-0 ${isCancelled ? 'rounded-2xl bg-charcoal-900/5 px-3' : ''}`}
                >
                  <img src={item.image} alt={item.name} className={`h-16 w-16 rounded-xl object-cover ${isCancelled ? 'opacity-60 grayscale' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-3">
                      <p className={`truncate font-bold text-charcoal-900 ${isCancelled ? 'text-charcoal-500 line-through' : ''}`}>
                        {item.name} <span className={`font-normal text-charcoal-500 ${isCancelled ? '' : ''}`}>× {item.quantity}</span>
                      </p>
                      {isCancelled ? (
                        <strong className="text-charcoal-500 line-through">{money(item.price * item.quantity)}</strong>
                      ) : (
                        <strong className="text-charcoal-900">{money(item.price * item.quantity)}</strong>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-charcoal-500">{item.spec} · {t('order.ordered_by', { name: item.orderedBy })}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-charcoal-700">{t(`order.stage.${item.stage}.label`)}</span>
                        {isCancelled && (
                          <span data-testid="cancel-approved-badge" className="rounded-full bg-chili-50 px-2 py-1 text-xs font-bold text-chili-600">{t('order.cancelled_label')}</span>
                        )}
                        {isCancelled && (
                          <span className="text-xs font-bold text-chili-500/80">{t('order.cancelled_price', { amount: money(item.price * item.quantity) })}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isRequested && <span data-testid="cancel-pending-badge" className="text-xs font-bold text-amber-500">{t('order.cancel_pending')}</span>}
                        {!item.cancelState && cancellable && (
                          <button data-testid="order-cancel-btn" onClick={() => openCancelDialog(item)} className="flex items-center gap-1 text-xs font-semibold text-charcoal-500 hover:text-chili-500" aria-label={t('order.cancel')}>
                            <RotateCcw size={13} />{t('order.cancel')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex w-full items-center justify-between rounded-2xl bg-rice-100 p-4"><span><small className="block text-charcoal-500">{t('order.total')}</small><strong className="text-xl text-chili-500">{money(total)}</strong></span><span className="flex items-center gap-1 text-sm font-bold text-charcoal-900">{t('order.view_detail')}<ChevronRight size={16} /></span></div>
          {approvedSum > 0 && (
            <p data-testid="order-cancelled-summary" className="mt-3 text-xs text-charcoal-500">{t('order.cancelled_price', { amount: money(approvedSum) })}</p>
          )}
          <Button onClick={onCheckout} className="mt-4 w-full"><ReceiptText size={17} />{t('order.checkout')}</Button>

          <section data-testid="order-cancel-log" className="mt-5 rounded-2xl border border-charcoal-900/5 bg-rice-50">
            <button
              type="button"
              onClick={() => setLogsExpanded((v) => !v)}
              className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left"
              aria-expanded={logsExpanded}
            >
              <span className="font-bold text-charcoal-900">{t('order.cancel_log_title')}</span>
              <span className="flex items-center gap-1 text-xs text-charcoal-500">{logsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
            </button>
            {logsExpanded && (
              <div className="border-t border-charcoal-900/5 px-4 pb-4 pt-3">
                {orderLogs.length === 0 ? (
                  <p className="text-xs text-charcoal-500">{t('order.cancel_log_empty')}</p>
                ) : (
                  <ul className="space-y-3">
                    {orderLogs.map((log) => (
                      <li key={log.id} className="rounded-xl bg-white p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <strong className="text-charcoal-900">{log.dishName} <span className="text-charcoal-500">× {log.quantity}</span></strong>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${log.status === 'open' ? 'bg-amber-100 text-amber-600' : log.status === 'approved' ? 'bg-chili-50 text-chili-600' : 'bg-charcoal-900/5 text-charcoal-500'}`}>
                            {log.status === 'open' ? t('order.cancel_log_status_open') : log.status === 'approved' ? t('order.cancel_log_status_approved') : t('order.cancel_log_status_denied')}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-charcoal-500">{t('order.cancel_log_reason')}：{t(`order.cancel_reasons.${log.reason}`)}</p>
                        {log.note && <p className="mt-1 text-xs text-charcoal-500">{t('order.cancel_log_note')}：{log.note}</p>}
                        <p className="mt-1 text-xs text-charcoal-500">{new Date(log.requestedAt).toLocaleString()}</p>
                        {log.status !== 'open' && log.decisionAt && (
                          <p className="mt-1 text-xs text-charcoal-500">{t('order.cancel_log_decided_by')} · {new Date(log.decisionAt).toLocaleString()}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </section>
      </div>

      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && closeCancelDialog()}>
        <DialogContent title={t('order.cancel_dialog_title')}>
          <p className="mt-2 text-sm text-charcoal-500">{t('order.cancel_dialog_desc')}</p>
          <div className="mt-5 space-y-4">
            <div>
                <span className="text-xs font-bold text-charcoal-700">{t('order.cancel_reason_label')}</span>
                <div role="radiogroup" aria-label={t('order.cancel_reason_label')} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {reasonKeys.map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={reason === key}
                      data-testid={`cancel-reason-${key}`}
                      onClick={() => setReason(key)}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${reason === key ? 'border-chili-500 bg-chili-50 text-chili-600' : 'border-charcoal-900/10 bg-white text-charcoal-700 hover:border-chili-500/30'}`}
                    >
                      <span className="font-semibold">{t(`order.cancel_reasons.${key}`)}</span>
                      {reason === key && <Check size={15} />}
                    </button>
                  ))}
                </div>
                {reason === '' && (
                  <p data-testid="cancel-reason-hint" className="mt-2 text-xs text-chili-500">{t('order.cancel_reason_required')}</p>
                )}
              </div>
            <div>
                <label className="text-xs font-bold text-charcoal-700" htmlFor="cancel-note">
                  {t('order.cancel_note_label')}{reason === 'other' ? ' *' : ''}
                </label>
                <textarea
                  id="cancel-note"
                  data-testid="cancel-note"
                  value={note}
                  maxLength={100}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('order.cancel_note_placeholder')}
                  className="mt-2 h-20 w-full resize-none rounded-xl border border-charcoal-900/10 bg-white p-3 text-sm text-charcoal-900 focus:border-chili-500 focus:outline-none"
                />
              </div>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={closeCancelDialog}>{t('common.back')}</Button>
            <Button
              data-testid="cancel-confirm-btn"
              disabled={!reason || (reason === 'other' && note.trim().length === 0)}
              onClick={submitCancel}
            >
              <RotateCcw size={17} />{t('order.cancel_confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
