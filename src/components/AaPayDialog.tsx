import { useTranslation } from 'react-i18next'
import { Check, ShieldCheck } from 'lucide-react'
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

/**
 * 邀请卡点击后弹出的子单支付 Dialog。
 *
 * 设计边界（SPEC §2.5.2a / §10.1 TASK-FE-006）：AaPayDialog 不在内部挂任何 confirm 弹窗与
 * confirmCloseOpen state，关闭拦截由父级 CheckoutView 集中持有（与「取消 AA」「退款」二次确认并列）。
 * `handleOpenChange(next)` 直接 `onOpenChange(next)` 透传给父级即可。
 *
 * UI 层并发守卫（reducer 是最终边界）：当子单 status !== 'pending' 时仍调用 onPay，
 * 由 reducer 内 `status !== 'pending'` 守卫写 message.aa_already_paid，UI 不关闭 Dialog；
 * 仅在子单确为 pending 时关闭 Dialog。
 */
export function AaPayDialog({ open, onOpenChange, session, diner, amountCents, items, onPay, onAbandon }: AaPayDialogProps) {
  const { t } = useTranslation()
  const sub: AaSubOrder | undefined = session.subOrders.find((s) => s.diner === diner)
  const amountDisplay = money(centsToYuan(amountCents))

  // 直接透传：关闭拦截由 CheckoutView 的 handlePayDialogOpenChange 持有二次确认 Dialog。
  const handleOpenChange = (next: boolean) => {
    onOpenChange(next)
  }

  const handlePay = () => {
    // UI 层软拦截（非 pending 时不关闭 Dialog，让 reducer SET_MESSAGE 提示本笔已支付）
    if (!sub || sub.status !== 'pending') {
      onPay()
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
