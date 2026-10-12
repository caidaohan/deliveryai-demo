/**
 * AA 流程与 `orderStage` 解耦：AA 入口仅在 CheckoutView 渲染，子单状态独立于菜品履约阶段，
 * 不影响 `orderItems[].stage`。
 */
import i18next from 'i18next'
import { uid, type Cents } from '@/lib/utils'
import type { AaMode, AaSession, AaSubOrder, AppAction, AppState, CancelReason } from '@/types'

const AA_TIMEOUT_MIN = 30_000
const AA_TIMEOUT_MAX = 1_800_000

export const initialState: AppState = {
  view: 'home',
  table: null,
  diners: ['姚乾', '林溪', '陈默'],
  cart: [],
  orderItems: [],
  orderStage: 'submitted',
  soldOut: ['p8'],
  services: [],
  paid: false,
  cancelLogs: [],
  aaSession: undefined,
  aaRefundLogs: [],
  lastMessage: i18next.t('message.welcome'),
}

const stageMessages: Record<string, string> = {
  submitted: 'message.stage_submitted',
  accepted: 'message.stage_accepted',
  cooking: 'message.stage_cooking',
  served: 'message.stage_served',
}

const localeForLanguage = (lang: string) => (lang === 'en' ? 'en-US' : 'zh-CN')

const cancellableStages = new Set(['submitted', 'accepted', 'cooking'])

// === AA 拆分辅助函数 ====================================================
// 所有拆分函数输入输出均为整数「分」，保证 Σ 子单 === payableCents 严格成立。

function distributeCents(totalCents: Cents, ratios: number[]): Cents[] {
  const n = ratios.length
  if (n === 0) return []
  const sumRatio = ratios.reduce((acc, r) => acc + r, 0) || 1
  const exact = ratios.map((r) => (totalCents * r) / sumRatio)
  const floored = exact.map((v) => Math.floor(v))
  let diff = totalCents - floored.reduce((acc, v) => acc + v, 0)
  const result = [...floored]
  // 余数按顺序（0..n-1）补齐到每个子单；diff 可能为负（极少），从尾部回退。
  let cursor = 0
  while (diff !== 0 && n > 0) {
    const idx = cursor % n
    if (diff > 0) {
      result[idx] += 1
      diff -= 1
    } else if (diff < 0 && result[idx] > 0) {
      result[idx] -= 1
      diff += 1
    }
    cursor += 1
    if (cursor > n * 1000) break // 兜底，防止极端情况死循环
  }
  return result
}

export function splitEqual(diners: string[], payableCents: Cents): AaSubOrder[] {
  if (diners.length === 0 || payableCents <= 0) return []
  return distributeCents(payableCents, diners.map(() => 1)).map((amountCents, i) => ({
    diner: diners[i],
    amountCents,
    status: 'pending' as const,
  }))
}

export function splitByRatio(diners: string[], payableCents: Cents, ratios: Record<string, number>): AaSubOrder[] {
  if (diners.length === 0 || payableCents <= 0) return []
  const list = diners.map((diner) => Math.max(0, Math.floor(ratios[diner] ?? 0)))
  return distributeCents(payableCents, list).map((amountCents, i) => ({
    diner: diners[i],
    amountCents,
    status: 'pending' as const,
  }))
}

export function splitByCustom(diners: string[], amountsCents: Record<string, Cents>): AaSubOrder[] {
  return diners.map((diner) => ({
    diner,
    amountCents: Math.max(0, Math.round(amountsCents[diner] ?? 0)),
    status: 'pending' as const,
  }))
}

// 当 AA 全部子单都处于 paid/refunded/cancelled（无 pending/expired/paid 等待）时回到单笔 PAY 路径
function shouldClearSession(subOrders: AaSubOrder[]): boolean {
  return subOrders.every((s) => s.status === 'cancelled' || s.status === 'refunded')
}

function allPaid(subOrders: AaSubOrder[]): boolean {
  return subOrders.length > 0 && subOrders.every((s) => s.status === 'paid')
}

export function orderReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'BIND_TABLE':
      return { ...state, table: action.table, view: 'welcome', lastMessage: i18next.t('message.bind_table', { table: action.table }) }
    case 'SET_VIEW':
      return { ...state, view: action.view }
    case 'ADD_CART': {
      const same = state.cart.find((item) => item.productId === action.item.productId && item.spec === action.item.spec && item.orderedBy === action.item.orderedBy)
      const cart = same
        ? state.cart.map((item) => item.uid === same.uid ? { ...item, quantity: item.quantity + 1 } : item)
        : [...state.cart, action.item]
      return { ...state, cart, lastMessage: i18next.t('message.add_cart', { name: action.item.orderedBy, dish: action.item.name }) }
    }
    case 'CHANGE_QTY': {
      const cart = state.cart
        .map((item) => item.uid === action.uid ? { ...item, quantity: item.quantity + action.delta } : item)
        .filter((item) => item.quantity > 0)
      return { ...state, cart }
    }
    case 'SUBMIT_ORDER': {
      if (!state.cart.length) return state
      const additions = state.cart.map((item) => ({ ...item, stage: 'submitted' as const }))
      return {
        ...state,
        orderItems: [...state.orderItems, ...additions],
        cart: [],
        orderStage: 'submitted',
        view: 'order',
        lastMessage: state.orderItems.length ? i18next.t('message.order_additional') : i18next.t('message.order_submitted'),
      }
    }
    case 'SET_STAGE':
      return {
        ...state,
        orderStage: action.stage,
        orderItems: state.orderItems.map((item) => ({ ...item, stage: action.stage })),
        lastMessage: i18next.t(stageMessages[action.stage]),
      }
    case 'TOGGLE_SOLD_OUT':
      return {
        ...state,
        soldOut: state.soldOut.includes(action.productId)
          ? state.soldOut.filter((id) => id !== action.productId)
          : [...state.soldOut, action.productId],
        lastMessage: i18next.t('message.soldout_updated'),
      }
    case 'CALL_SERVICE': {
      const serviceName = i18next.t(`${action.service}.name`)
      return {
        ...state,
        services: [...state.services, { id: uid(), type: serviceName, createdAt: new Date().toLocaleTimeString(localeForLanguage(i18next.language), { hour: '2-digit', minute: '2-digit' }), status: 'waiting' }],
        lastMessage: i18next.t('message.service_called', { service: serviceName }),
      }
    }
    case 'RESPOND_SERVICES':
      return { ...state, services: state.services.map((service) => ({ ...service, status: 'responded' })), lastMessage: i18next.t('message.service_responded') }
    case 'REQUEST_CANCEL': {
      const target = state.orderItems.find((item) => item.uid === action.uid)
      // 守卫：未指定 reason、菜品已上桌、已存在 cancelState、找不到菜品 → 直接拒绝并 setMessage
      if (!target) return { ...state, lastMessage: i18next.t('message.cancel_reason_required') }
      if (!action.reason) return { ...state, lastMessage: i18next.t('message.cancel_reason_required') }
      if (!cancellableStages.has(target.stage)) return state
      if (target.cancelState) return state
      const trimmedNote = action.note?.trim()
      const note = trimmedNote ? trimmedNote.slice(0, 100) : undefined
      if (action.reason === 'other' && !note) return { ...state, lastMessage: i18next.t('message.cancel_reason_required') }
      const now = new Date().toISOString()
      return {
        ...state,
        orderItems: state.orderItems.map((item) => item.uid === action.uid
          ? { ...item, cancelState: 'requested', cancelReason: action.reason, cancelNote: note, cancelRequestedAt: now }
          : item),
        cancelLogs: [
          ...state.cancelLogs,
          {
            id: uid(),
            orderItemUid: action.uid,
            dishName: target.name,
            quantity: target.quantity,
            reason: action.reason as CancelReason,
            note,
            requestedBy: 'customer',
            requestedAt: now,
            status: 'open',
          },
        ],
        lastMessage: i18next.t('message.cancel_requested'),
      }
    }
    case 'APPROVE_CANCEL': {
      const target = state.orderItems.find((item) => item.uid === action.uid)
      if (!target || target.cancelState !== 'requested') return state
      const now = new Date().toISOString()
      return {
        ...state,
        orderItems: state.orderItems.map((item) => item.uid === action.uid ? { ...item, cancelState: 'approved' } : item),
        cancelLogs: state.cancelLogs.map((log) => log.orderItemUid === action.uid && log.status === 'open'
          ? { ...log, status: 'approved', decision: 'approved', decisionAt: now, decidedBy: 'demo-staff' }
          : log),
        lastMessage: i18next.t('message.cancel_approved'),
      }
    }
    case 'DENY_CANCEL': {
      const target = state.orderItems.find((item) => item.uid === action.uid)
      if (!target || target.cancelState !== 'requested') return state
      const now = new Date().toISOString()
      return {
        ...state,
        orderItems: state.orderItems.map((item) => item.uid === action.uid
          ? { ...item, cancelState: undefined, cancelReason: undefined, cancelNote: undefined, cancelRequestedAt: undefined }
          : item),
        cancelLogs: state.cancelLogs.map((log) => log.orderItemUid === action.uid && log.status === 'open'
          ? { ...log, status: 'denied', decision: 'denied', decisionAt: now, decidedBy: 'demo-staff' }
          : log),
        lastMessage: i18next.t('message.cancel_denied'),
      }
    }
    case 'PAY':
      return { ...state, paid: true, lastMessage: i18next.t('message.paid') }
    case 'RESET':
      return { ...initialState, cancelLogs: [], aaRefundLogs: [], lastMessage: i18next.t('message.reset') }
    case 'SET_MESSAGE':
      return { ...state, lastMessage: action.message }

    // === AA: 创建会话 + 拆分 ============================================
    case 'AA_CREATE_SESSION': {
      // 守卫 1：基本合法性
      if (action.payableCents <= 0 || action.diners.length < 2) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }
      // 守卫 2：超时范围
      if (action.timeoutMs < AA_TIMEOUT_MIN || action.timeoutMs > AA_TIMEOUT_MAX) {
        return { ...state, lastMessage: i18next.t('message.aa_timeout_range') }
      }

      let subOrders: AaSubOrder[] = []
      let ok = true
      if (action.mode === 'equal') {
        subOrders = splitEqual(action.diners, action.payableCents)
      } else if (action.mode === 'ratio') {
        const ratios = action.ratioInputs ?? {}
        const sum = action.diners.reduce((acc, diner) => acc + Math.max(0, Math.floor(ratios[diner] ?? 0)), 0)
        if (sum !== 100) ok = false
        if (ok) subOrders = splitByRatio(action.diners, action.payableCents, ratios)
      } else if (action.mode === 'custom') {
        const amountsCents = action.customInputs ?? {}
        const sumCents = action.diners.reduce((acc, diner) => acc + Math.max(0, Math.round(amountsCents[diner] ?? 0)), 0)
        if (sumCents !== action.payableCents) ok = false
        if (ok) subOrders = splitByCustom(action.diners, amountsCents)
      }
      if (!ok || subOrders.length !== action.diners.length) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }

      const aaSession: AaSession = {
        id: uid(),
        mode: action.mode,
        ratioInputs: action.ratioInputs,
        customInputs: action.customInputs,
        subOrders,
        timeoutMs: action.timeoutMs,
        createdAt: new Date().toISOString(),
      }
      return {
        ...state,
        aaSession,
        lastMessage: i18next.t('message.aa_created'),
      }
    }

    // === AA: 子单支付 ===================================================
    case 'AA_PAY_SUB_ORDER': {
      if (!state.aaSession || state.aaSession.id !== action.sessionId) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }
      const sub = state.aaSession.subOrders.find((s) => s.diner === action.diner)
      if (!sub) return state
      if (sub.status !== 'pending') {
        return { ...state, lastMessage: i18next.t('message.aa_already_paid') }
      }
      const now = new Date().toISOString()
      const nextSubOrders = state.aaSession.subOrders.map((s) =>
        s.diner === action.diner ? { ...s, status: 'paid' as const, paidAt: now } : s,
      )
      const sessionAllPaid = allPaid(nextSubOrders)
      return {
        ...state,
        aaSession: { ...state.aaSession, subOrders: nextSubOrders },
        paid: sessionAllPaid ? true : state.paid,
        lastMessage: sessionAllPaid ? i18next.t('message.paid') : i18next.t('message.aa_created'),
      }
    }

    // === AA: 子单过期 ===================================================
    case 'AA_EXPIRE_SUB_ORDER': {
      if (!state.aaSession || state.aaSession.id !== action.sessionId) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }
      const sub = state.aaSession.subOrders.find((s) => s.diner === action.diner)
      if (!sub || sub.status !== 'pending') return state
      const now = new Date().toISOString()
      const nextSubOrders = state.aaSession.subOrders.map((s) =>
        s.diner === action.diner ? { ...s, status: 'expired' as const, expiredAt: now } : s,
      )
      return {
        ...state,
        aaSession: { ...state.aaSession, subOrders: nextSubOrders },
        lastMessage: i18next.t('message.aa_invalid_session'),
      }
    }

    // === AA: 全部取消 ===================================================
    case 'AA_CANCEL_ALL': {
      if (!state.aaSession || state.aaSession.id !== action.sessionId) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }
      const now = new Date().toISOString()
      const nextSubOrders = state.aaSession.subOrders.map((s) => {
        if (s.status === 'pending' || s.status === 'expired') {
          return { ...s, status: 'cancelled' as const, cancelledAt: now }
        }
        return s
      })
      const cleared = shouldClearSession(nextSubOrders)
      const nextState: AppState = {
        ...state,
        aaSession: cleared ? undefined : { ...state.aaSession, subOrders: nextSubOrders },
        paid: cleared ? false : state.paid,
        lastMessage: i18next.t('message.aa_cancelled'),
      }
      return nextState
    }

    // === AA: 子单单退款 =================================================
    case 'AA_REFUND_SUB_ORDER': {
      if (!state.aaSession || state.aaSession.id !== action.sessionId) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }
      const sub = state.aaSession.subOrders.find((s) => s.diner === action.diner)
      if (!sub || sub.status !== 'paid') return state
      const now = new Date().toISOString()
      const nextSubOrders = state.aaSession.subOrders.map((s) =>
        s.diner === action.diner ? { ...s, status: 'refunded' as const, refundedAt: now } : s,
      )
      const refundLog = {
        id: uid(),
        sessionId: action.sessionId,
        diner: action.diner,
        amountCents: sub.amountCents,
        reason: 'aa_other' as const,
        note: action.note?.trim() ? action.note.trim().slice(0, 100) : undefined,
        requestedBy: 'customer' as const,
        requestedAt: now,
        decisionAt: now,
        status: 'approved' as const,
      }
      // 主单在出现 refunded 后回到 false；保持 aaSession 以便继续显示「N 已退款」
      return {
        ...state,
        aaSession: { ...state.aaSession, subOrders: nextSubOrders },
        aaRefundLogs: [...state.aaRefundLogs, refundLog],
        paid: false,
        lastMessage: i18next.t('message.aa_refunded'),
      }
    }

    // === AA: 重新发起（expired → pending） ============================
    case 'AA_REISSUE_SUB_ORDER': {
      if (!state.aaSession || state.aaSession.id !== action.sessionId) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }
      const sub = state.aaSession.subOrders.find((s) => s.diner === action.diner)
      if (!sub || sub.status !== 'expired') return state
      const nextSubOrders = state.aaSession.subOrders.map((s) => {
        if (s.diner !== action.diner) return s
        // 重置与时间相关字段，到期时间戳由 hook 重新计算（now + timeoutMs）
        const { expiredAt: _e, ...rest } = s
        void _e
        return { ...rest, status: 'pending' as const }
      })
      return {
        ...state,
        aaSession: { ...state.aaSession, subOrders: nextSubOrders },
        lastMessage: i18next.t('message.aa_created'),
      }
    }

    // === AA: 调整超时（不重计时已存在 pending） =========================
    case 'AA_SET_TIMEOUT': {
      if (!state.aaSession || state.aaSession.id !== action.sessionId) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }
      if (action.timeoutMs < AA_TIMEOUT_MIN || action.timeoutMs > AA_TIMEOUT_MAX) {
        return { ...state, lastMessage: i18next.t('message.aa_timeout_range') }
      }
      return {
        ...state,
        aaSession: { ...state.aaSession, timeoutMs: action.timeoutMs },
        lastMessage: i18next.t('message.aa_created'),
      }
    }

    // === AA: 全部一次性过期 ============================================
    case 'AA_EXPIRE_ALL': {
      if (!state.aaSession || state.aaSession.id !== action.sessionId) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }
      const now = new Date().toISOString()
      const nextSubOrders = state.aaSession.subOrders.map((s) =>
        s.status === 'pending' ? { ...s, status: 'expired' as const, expiredAt: now } : s,
      )
      return {
        ...state,
        aaSession: { ...state.aaSession, subOrders: nextSubOrders },
        lastMessage: i18next.t('message.aa_invalid_session'),
      }
    }

    // === AA: 清空会话与日志 ============================================
    case 'AA_RESET': {
      // sessionId 与当前不匹配则拒绝（防止误清）；未传则视为无条件清空（DemoConsole 内部已确认存在）
      if (action.sessionId !== undefined && state.aaSession && state.aaSession.id !== action.sessionId) {
        return { ...state, lastMessage: i18next.t('message.aa_invalid_session') }
      }
      return {
        ...state,
        aaSession: undefined,
        aaRefundLogs: [],
        paid: false,
        lastMessage: i18next.t('message.reset'),
      }
    }

    default:
      return state
  }
}

// 工具：避免 reducer 中 AA_RATIO / CUSTOM 校验时的 lint 提示 unused
const _aaModeGuard: AaMode = 'equal'
void _aaModeGuard
