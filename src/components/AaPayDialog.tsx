import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { centsToYuan, money } from '@/lib/utils'
import type { AaSession, AaSubOrder, OrderItem } from '@/types'

interface AaPayDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: AaSession
  diner: string
  amountCents: number
  items: OrderItem[]
  onPay: () => void
  onAbandon: () => void
}

export function AaPayDialog({ open, onOpenChange, session, diner, amountCents, items, onPay, onAbandon }: AaPayDialogProps) {
  const { t } = useTranslation()
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const sub: AaSubOrder | undefined = session.subOrders.find((s) => s.diner === diner)
  const amountDisplay = money(centsToYuan(amountCents))

  // 拦截：Radix Dialog 的 onOpenChange(false) 触发（包括遮罩、Esc、关闭按钮）。
  // 我们只在「当前对话真正关闭」前弹二次确认；二次确认内的关闭直接放行。
  const handleOpenChange = (next: boolean) => {
    if (!next && !confirmCloseOpen) {
      setConfirmCloseOpen(true)
      return
    }
    onOpenChange(next)
  }

  const handlePay = () => {
    // 并发守卫：reducer 内是最终边界，但 UI 层提前拦截可避免误点击
    if (!sub || sub.status !== 'pending') {
      // 透传 onPay 触发 reducer 守卫（会写 aa_already_paid message）
      onPay()
      onOpenChange(false)
      return
    }
    onPay()
    onOpenChange(false)
  }

  const handleAbandon = () => {
    onAbandon()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent title={t('checkout.aa_pay_sub', { name: diner })} className="md:max-w-md">
        <div className="mt-4 space-y-4">
          <section data-testid="aa-pay-amount" className="rounded-2xl bg-white p-4 shadow-card">
            <p className="text-xs font-bold text-chili-500">{t('checkout.aa_pay_sub', { name: diner })}</p>
            <p className="mt-2 text-3xl font-extrabold text-chili-500">{amountDisplay}</p>
            <p className="mt-2 text-sm text-charcoal-500">{t('checkout.aa_pay_self', { amount: centsToYuan(amountCents).toFixed(2) })}</p>
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-card">
            <p className="text-xs font-bold text-charcoal-500">{t('checkout.title')}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {items.map((item) => (
                <li key={item.uid} className="flex justify-between">
                  <span className="text-charcoal-700">{item.name} <small className="text-charcoal-500">× {item.quantity}</small></span>
                  <span className="font-semibold text-charcoal-900">{money(item.price * item.quantity)}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="flex flex-col gap-2">
            <Button data-testid="aa-pay-confirm" onClick={handlePay}>
              <Check size={17} />{t('checkout.confirm_pay', { amount: amountDisplay })}
            </Button>
            <Button data-testid="aa-pay-abandon" variant="outline" onClick={handleAbandon}>
              <ShieldCheck size={17} />{t('checkout.aa_pay_abandon')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 单独的二次确认 Dialog，用于 AaPayDialog 关闭时拦截。
 * 不嵌入 AaPayDialog 本身，因为 Radix Dialog 不允许嵌套 open=true 的实例。
 */
export function AaPayCloseConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('checkout.aa_already_paid').length === 0 ? '' : ''}>
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-amber-100/70 p-3">
            <span className="rounded-full bg-white p-2 text-amber-500"><AlertTriangle size={18} /></span>
            <p className="text-sm leading-6 text-charcoal-700">{t('checkout.aa_dialog_close_confirm')}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button data-testid="aa-dialog-close-confirm" onClick={() => { onConfirm(); onOpenChange(false) }}>
              <Check size={17} />{t('checkout.aa_pay_abandon')}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X size={17} />{t('common.back')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
