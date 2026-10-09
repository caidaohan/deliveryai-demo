import i18next from 'i18next'
import { uid } from '@/lib/utils'
import type { AppAction, AppState, CancelReason } from '@/types'

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
      return { ...initialState, cancelLogs: [], lastMessage: i18next.t('message.reset') }
    case 'SET_MESSAGE':
      return { ...state, lastMessage: action.message }
    default:
      return state
  }
}
