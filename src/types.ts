export type OrderStage = 'submitted' | 'accepted' | 'cooking' | 'served'
export type ViewName = 'home' | 'welcome' | 'menu' | 'order' | 'checkout'

export interface Product {
  id: string
  name: string
  description: string
  category: string
  price: number
  image: string
  badge?: string
  orderedCount?: number
  options?: {
    portion?: string[]
    flavor?: string[]
    spicy?: string[]
  }
}

export interface CartItem {
  uid: string
  productId: string
  name: string
  price: number
  quantity: number
  image: string
  spec: string
  orderedBy: string
}

export type CancelReason =
  | 'wrong_order'
  | 'wrong_dish'
  | 'quality'
  | 'allergen'
  | 'soldout_late'
  | 'kitchen_refuse'
  | 'other'

export interface OrderItem extends CartItem {
  stage: OrderStage
  cancelState?: 'requested' | 'approved'
  cancelReason?: CancelReason
  cancelNote?: string
  cancelRequestedAt?: string
}

export interface CancelLog {
  id: string
  orderItemUid: string
  dishName: string
  quantity: number
  reason: CancelReason
  note?: string
  requestedBy: 'customer'
  requestedAt: string
  decisionAt?: string
  decision?: 'approved' | 'denied'
  decidedBy?: 'demo-staff'
  status: 'open' | 'approved' | 'denied'
}

export interface ServiceRequest {
  id: string
  type: string
  createdAt: string
  status: 'waiting' | 'responded'
}

// AA 结账：金额一律以整数「分」累加；UI 输入用元，先 moneyCents 归一化后再做校验。
export type AaMode = 'equal' | 'ratio' | 'custom'
export type AaSubOrderStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded'

export interface AaSubOrder {
  diner: string
  amountCents: number
  status: AaSubOrderStatus
  paidAt?: string
  expiredAt?: string
  cancelledAt?: string
  refundedAt?: string
}

export interface AaSession {
  id: string
  mode: AaMode
  ratioInputs?: Record<string, number>
  customInputs?: Record<string, number>
  subOrders: AaSubOrder[]
  timeoutMs: number
  createdAt: string
}

export type AaRefundReason = 'aa_cancel' | 'aa_other'

export interface AaRefundLog {
  id: string
  sessionId: string
  diner: string
  amountCents: number
  reason: AaRefundReason
  note?: string
  requestedBy: 'customer'
  requestedAt: string
  decisionAt: string
  status: 'approved'
}

export interface AppState {
  view: ViewName
  table: string | null
  diners: string[]
  cart: CartItem[]
  orderItems: OrderItem[]
  orderStage: OrderStage
  soldOut: string[]
  services: ServiceRequest[]
  paid: boolean
  cancelLogs: CancelLog[]
  // AA 会话：创建时存在；全部完成 / 全部取消 / 重置后为 undefined（与 paid 字段独立）。
  aaSession?: AaSession
  aaRefundLogs: AaRefundLog[]
  lastMessage: string
}

export type AppAction =
  | { type: 'BIND_TABLE'; table: string }
  | { type: 'SET_VIEW'; view: ViewName }
  | { type: 'ADD_CART'; item: CartItem }
  | { type: 'CHANGE_QTY'; uid: string; delta: number }
  | { type: 'SUBMIT_ORDER' }
  | { type: 'SET_STAGE'; stage: OrderStage }
  | { type: 'TOGGLE_SOLD_OUT'; productId: string }
  | { type: 'CALL_SERVICE'; service: string }
  | { type: 'RESPOND_SERVICES' }
  | { type: 'REQUEST_CANCEL'; uid: string; reason: CancelReason; note?: string }
  | { type: 'APPROVE_CANCEL'; uid: string }
  | { type: 'DENY_CANCEL'; uid: string }
  | { type: 'PAY' }
  | { type: 'RESET' }
  | { type: 'SET_MESSAGE'; message: string }
  // AA 结账：8 个 action（详见 docs/requirements/aa-checkout.technical-spec.md §2.4）
  | { type: 'AA_CREATE_SESSION'; diners: string[]; mode: AaMode; payableCents: number; timeoutMs: number; ratioInputs?: Record<string, number>; customInputs?: Record<string, number> }
  | { type: 'AA_PAY_SUB_ORDER'; sessionId: string; diner: string }
  | { type: 'AA_EXPIRE_SUB_ORDER'; sessionId: string; diner: string }
  | { type: 'AA_CANCEL_ALL'; sessionId: string }
  | { type: 'AA_REFUND_SUB_ORDER'; sessionId: string; diner: string; note?: string }
  | { type: 'AA_REISSUE_SUB_ORDER'; sessionId: string; diner: string }
  | { type: 'AA_SET_TIMEOUT'; sessionId: string; timeoutMs: number }
  | { type: 'AA_EXPIRE_ALL'; sessionId: string }
  | { type: 'AA_RESET'; sessionId?: string }
