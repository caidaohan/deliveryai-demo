import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CheckCircle2, ChefHat, ClipboardList, RotateCcw, Store, ToggleLeft, UtensilsCrossed, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { products, tableAreas } from '@/data/menu'
import type { CancelLog, OrderItem, OrderStage, ServiceRequest } from '@/types'

const stageIcons: Record<OrderStage, typeof ChefHat> = {
  submitted: Store,
  accepted: CheckCircle2,
  cooking: ChefHat,
  served: UtensilsCrossed,
}
const stageKeys: OrderStage[] = ['submitted', 'accepted', 'cooking', 'served']

interface DemoConsoleProps {
  open: boolean
  table: string
  stage: OrderStage
  soldOut: string[]
  services: ServiceRequest[]
  orderItems: OrderItem[]
  cancelLogs: CancelLog[]
  onOpenChange: (open: boolean) => void
  onStage: (stage: OrderStage) => void
  onSoldOut: (id: string) => void
  onRespond: () => void
  onApproveCancel: (uid: string) => void
  onDenyCancel: (uid: string) => void
  onApproveAllCancel: () => void
  onReset: () => void
}

export function DemoConsole({ open, table, stage, soldOut, services, orderItems, cancelLogs, onOpenChange, onStage, onSoldOut, onRespond, onApproveCancel, onDenyCancel, onApproveAllCancel, onReset }: DemoConsoleProps) {
  const { t } = useTranslation()
  const waiting = services.filter((service) => service.status === 'waiting').length
  const areaKey = tableAreas[table]
  const tableLabel = areaKey ? `${table} · ${t(areaKey)}` : table

  const pendingItems = useMemo(
    () => orderItems.filter((item) => item.cancelState === 'requested'),
    [orderItems],
  )
  const orderedLogs = useMemo(() => cancelLogs.slice().reverse().slice(0, 20), [cancelLogs])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('console.title')} className="md:max-w-2xl">
        <p className="mt-2 text-sm text-charcoal-500">{t('console.desc')}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><h3 className="font-bold text-charcoal-900">{t('console.table_fulfillment')}</h3><span className="rounded-full bg-rice-100 px-3 py-1 text-xs font-bold text-charcoal-500">{tableLabel}</span></div>
            <div className="mt-4 grid grid-cols-2 gap-2">{stageKeys.map((value) => { const Icon = stageIcons[value]; return <button key={value} onClick={() => onStage(value)} className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm font-bold transition ${stage === value ? 'border-chili-500 bg-chili-50 text-chili-600' : 'border-charcoal-900/5 bg-rice-50 text-charcoal-500'}`}><Icon size={16} />{t(`console.stage.${value}`)}</button> })}</div>
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><h3 className="font-bold text-charcoal-900">{t('console.service_response')}</h3><span className={`rounded-full px-3 py-1 text-xs font-bold ${waiting ? 'bg-amber-100 text-amber-500' : 'bg-emerald-50 text-emerald-600'}`}>{t('console.waiting_count', { count: waiting })}</span></div>
            <p className="mt-4 text-sm leading-6 text-charcoal-500">{t('console.response_desc')}</p>
            <Button onClick={onRespond} disabled={!waiting} variant="secondary" className="mt-3 w-full"><CheckCircle2 size={17} />{t('console.respond_btn')}</Button>
          </section>
        </div>

        <section data-testid="console-cancel-review" className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="rounded-xl bg-chili-50 p-2 text-chili-500"><ClipboardList size={17} /></span>
              <h3 className="font-bold text-charcoal-900">{t('console.cancel_review_title')}</h3>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${pendingItems.length ? 'bg-amber-100 text-amber-500' : 'bg-emerald-50 text-emerald-600'}`}>
              {pendingItems.length ? t('console.cancel_pending_count', { count: pendingItems.length }) : t('console.cancel_no_open')}
            </span>
          </div>
          {pendingItems.length === 0 ? (
            <p data-testid="console-cancel-empty" className="mt-3 text-sm text-charcoal-500">{t('console.cancel_review_empty')}</p>
          ) : (
            <div className="mt-3 space-y-3">
              {pendingItems.map((item) => (
                <div key={item.uid} data-testid={`console-cancel-row-${item.uid}`} className="rounded-xl border border-charcoal-900/5 bg-rice-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-charcoal-900">{item.name} <span className="text-charcoal-500">× {item.quantity}</span></p>
                      <p className="mt-0.5 text-xs text-charcoal-500">{item.spec} · {t('order.ordered_by', { name: item.orderedBy })}</p>
                      <p className="mt-1 text-xs text-charcoal-500">{t('order.cancel_log_reason')}：{item.cancelReason ? t(`order.cancel_reasons.${item.cancelReason}`) : ''}</p>
                      {item.cancelNote && <p className="mt-1 text-xs text-charcoal-500">{t('order.cancel_log_note')}：{item.cancelNote}</p>}
                      {item.cancelRequestedAt && <p className="mt-1 text-xs text-charcoal-500">{new Date(item.cancelRequestedAt).toLocaleString()}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <Button data-testid={`console-cancel-approve-${item.uid}`} onClick={() => onApproveCancel(item.uid)} className="px-3 py-2 text-xs">
                        <Check size={15} />{t('console.cancel_approve')}
                      </Button>
                      <Button data-testid={`console-cancel-deny-${item.uid}`} variant="outline" onClick={() => onDenyCancel(item.uid)} className="px-3 py-2 text-xs">
                        <XCircle size={15} />{t('console.cancel_deny')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {pendingItems.length >= 2 && (
                <Button data-testid="console-cancel-approve-all" onClick={onApproveAllCancel} variant="secondary" className="w-full">
                  <CheckCircle2 size={17} />{t('console.cancel_approve_all')}
                </Button>
              )}
            </div>
          )}
          <div data-testid="console-cancel-log" className="mt-4 rounded-xl bg-rice-50 p-3">
            <p className="text-xs font-bold text-charcoal-700">{t('console.cancel_log_title')}</p>
            {orderedLogs.length === 0 ? (
              <p className="mt-2 text-xs text-charcoal-500">{t('console.cancel_log_empty')}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {orderedLogs.map((log) => (
                  <li key={log.id} className="rounded-lg bg-white px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <strong className="text-charcoal-900">{log.dishName} <span className="text-charcoal-500">× {log.quantity}</span></strong>
                      <span className={`rounded-full px-2 py-0.5 font-bold ${log.status === 'open' ? 'bg-amber-100 text-amber-600' : log.status === 'approved' ? 'bg-chili-50 text-chili-600' : 'bg-charcoal-900/5 text-charcoal-500'}`}>
                        {log.status === 'open' ? t('order.cancel_log_status_open') : log.status === 'approved' ? t('order.cancel_log_status_approved') : t('order.cancel_log_status_denied')}
                      </span>
                    </div>
                    <p className="mt-1 text-charcoal-500">{t('order.cancel_log_reason')}：{t(`order.cancel_reasons.${log.reason}`)}</p>
                    {log.note && <p className="mt-1 text-charcoal-500">{t('order.cancel_log_note')}：{log.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><h3 className="font-bold text-charcoal-900">{t('console.soldout_title')}</h3><span className="flex items-center gap-1 text-xs text-charcoal-500"><ToggleLeft size={16} />{t('console.soldout_hint')}</span></div>
          <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto pb-1">{products.map((product) => { const unavailable = soldOut.includes(product.id); return <button key={product.id} onClick={() => onSoldOut(product.id)} className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${unavailable ? 'border-chili-500/30 bg-chili-50 text-chili-600' : 'border-charcoal-900/5 bg-rice-50 text-charcoal-500'}`}>{unavailable ? <XCircle size={15} /> : <CheckCircle2 size={15} />}{t(product.name)}</button> })}</div>
        </section>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Button variant="outline" onClick={onReset}><RotateCcw size={17} />{t('console.reset')}</Button><Button onClick={() => onOpenChange(false)}>{t('console.done')}</Button></div>
      </DialogContent>
    </Dialog>
  )
}
