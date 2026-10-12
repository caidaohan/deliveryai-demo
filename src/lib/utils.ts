import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const money = (value: number) => `¥${value.toFixed(2)}`

/**
 * 整数「分」语义别名：仅用于类型标注让 reducer / 拆分函数读起来更清晰。
 * 运行期与 `number` 完全等价。
 */
export type Cents = number

/**
 * 元（number，可含小数）→ 整数分（四舍五入）。
 * 用于 UI 输入 → reducer 拆分函数归一化；避免 `0.1 + 0.2 !== 0.3` 的浮点误差。
 */
export function moneyCents(yuan: number): Cents {
  if (!Number.isFinite(yuan)) return 0
  return Math.round(yuan * 100)
}

/**
 * 整数分（cents）→ 元（保留 2 位小数的 number），给 `money()` 显示用。
 */
export function centsToYuan(cents: Cents): number {
  if (!Number.isFinite(cents)) return 0
  return Math.round(cents) / 100
}

// crypto.randomUUID 仅在安全上下文（https / localhost）可用；
// 通过局域网 IP 或 file:// 打开时它是 undefined，直接调用会抛错。
// 演示为纯前端应用，需在任意来源下都能生成唯一 id，故降级为 Math.random 方案。
export function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // 忽略：不可用时走下方降级分支
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
