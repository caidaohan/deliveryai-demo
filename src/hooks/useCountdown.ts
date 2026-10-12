import { useEffect, useState } from 'react'
import type { AaSession } from '@/types'

/**
 * AA 子单倒计时 hook：
 * - 对每个 pending 子单设置 setTimeout 到 expiryAt 触发 onExpire(sub.diner)；
 * - 同时 1Hz 推进内部 tick 触发组件重渲染以更新 mm:ss；
 * - cleanup 覆盖：aaSession === undefined / 子单 status 不再 pending / 组件卸载三类。
 *
 * 不对 reducer 入参做时间戳持久化：到期时间 = (Date.parse(sub.paidAt?) 或会话 createdAt) + timeoutMs，
 * 但 reissue 后 expired 子单回到 pending，expiryAt 自然重算为「now + timeoutMs」（reducer 已清掉 expiredAt）。
 */
export function useCountdown(
  aaSession: AaSession | undefined,
  onExpire: (diner: string) => void,
) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!aaSession) return undefined
    const createdTs = Date.parse(aaSession.createdAt)
    if (!Number.isFinite(createdTs)) return undefined

    const timeouts: number[] = []
    for (const sub of aaSession.subOrders) {
      if (sub.status !== 'pending') continue
      // reissue 后 sub.paidAt 不存在，按当前时间重算；正常 pending 子单按会话 createdAt 起算
      const baseTs = Date.parse(sub.paidAt ?? aaSession.createdAt) || createdTs
      const expiryAt = baseTs + aaSession.timeoutMs
      const delay = Math.max(0, expiryAt - Date.now())
      const handle = setTimeout(() => {
        onExpire(sub.diner)
      }, delay)
      timeouts.push(handle as unknown as number)
    }

    const interval = window.setInterval(() => {
      setTick((n) => n + 1)
    }, 1000)

    return () => {
      for (const id of timeouts) clearTimeout(id)
      clearInterval(interval)
    }
    // aaSession 引用变化时重建定时器；onExpire 通过闭包捕获
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aaSession?.id, aaSession?.createdAt, aaSession?.timeoutMs, aaSession?.subOrders.map((s) => `${s.diner}:${s.status}`).join('|')])

  const createdTs = aaSession ? Date.parse(aaSession.createdAt) : NaN
  const timeoutMs = aaSession?.timeoutMs ?? 0

  // 每次渲染都返回新对象；memo 化的成本相对低频更划算。
  // 1Hz tick 已经通过组件重渲染驱动 mm:ss 更新。
  void tick
  void timeoutMs
  void createdTs
  const remainingMs = (diner: string): number => {
    if (!aaSession) return 0
    const sub = aaSession.subOrders.find((s) => s.diner === diner)
    if (!sub || sub.status !== 'pending') return 0
    const baseTs = Date.parse(sub.paidAt ?? aaSession.createdAt) || createdTs
    const expiryAt = baseTs + timeoutMs
    return Math.max(0, expiryAt - Date.now())
  }
  const formatted = (diner: string): string => {
    const ms = remainingMs(diner)
    const totalSec = Math.floor(ms / 1000)
    const mm = Math.floor(totalSec / 60).toString().padStart(2, '0')
    const ss = (totalSec % 60).toString().padStart(2, '0')
    return `${mm}:${ss}`
  }
  return {
    remainingMs,
    formatted,
    _tick: tick,
  }
}
