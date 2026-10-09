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
