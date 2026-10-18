import type {
  AdminMenu,
  AdminOrderDetail,
  AdminOrderSummary,
  AdminSummary,
  AdminZone,
  DayAvailability,
  EditableSetting,
  KitchenDay,
  OrderListView,
  ScheduleEntry,
} from '../shared/admin'
import type { OrderStatus } from '../shared/orders'
import type { Category, Slot } from '../shared/types'

export class AdminApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

/** Called when the server says the session has ended, so the app can show the login screen. */
let onSignedOut: () => void = () => {}
export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api/admin' + path, {
      ...init,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mjk-admin', ...init.headers },
    })
  } catch {
    throw new AdminApiError('No connection. Check your internet and try again.', 0)
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') onSignedOut()
    throw new AdminApiError(body.error ?? 'Something went wrong. Please try again.', res.status)
  }
  return body as T
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  login: (name: string, password: string) => request<{ name: string }>('/login', send('POST', { name, password })),
  logout: () => request<{ ok: true }>('/logout', send('POST')),
  me: () => request<{ name: string }>('/me'),

  summary: () => request<AdminSummary>('/summary'),
  orders: (view: OrderListView, q = '') =>
    request<{ orders: AdminOrderSummary[] }>(`/orders?view=${view}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  order: (code: string) => request<AdminOrderDetail>(`/orders/${encodeURIComponent(code)}`),
  setStatus: (code: string, from: OrderStatus, to: OrderStatus, note = '') =>
    request<AdminOrderDetail>(`/orders/${encodeURIComponent(code)}/status`, send('POST', { from, to, note })),
  setNotes: (code: string, notes: string) => request<AdminOrderDetail>(`/orders/${encodeURIComponent(code)}/notes`, send('POST', { notes })),
  kitchen: (date: string) => request<KitchenDay>(`/kitchen?date=${date}`),

  menu: () => request<AdminMenu>('/menu'),
  addProduct: (p: ProductBody & { category: Category; variant: VariantBody }) => request<AdminMenu>('/products', send('POST', p)),
  saveProduct: (id: string, p: ProductBody) => request<AdminMenu>(`/products/${encodeURIComponent(id)}`, send('PUT', p)),
  addVariant: (productId: string, v: VariantBody) => request<AdminMenu>(`/products/${encodeURIComponent(productId)}/variants`, send('POST', v)),
  saveVariant: (id: string, v: VariantBody) => request<AdminMenu>(`/variants/${encodeURIComponent(id)}`, send('PUT', v)),
  saveSchedule: (productId: string, entries: ScheduleEntry[]) =>
    request<AdminMenu>(`/schedule/${encodeURIComponent(productId)}`, send('PUT', { entries })),
  availability: (days = 21) => request<{ days: DayAvailability[] }>(`/availability?days=${days}`),
  setAvailability: (productId: string, date: string, slot: Slot, maxPortions: number | null) =>
    request<{ ok: true }>('/availability', send('PUT', { productId, date, slot, maxPortions })),

  zones: () => request<{ zones: AdminZone[] }>('/zones'),
  addZone: (z: ZoneBody) => request<{ zones: AdminZone[] }>('/zones', send('POST', z)),
  saveZone: (id: string, z: ZoneBody) => request<{ zones: AdminZone[] }>(`/zones/${encodeURIComponent(id)}`, send('PUT', z)),
  deleteZone: (id: string) => request<{ zones: AdminZone[] }>(`/zones/${encodeURIComponent(id)}`, send('DELETE')),

  settings: () => request<{ settings: Record<EditableSetting, string> }>('/settings'),
  saveSettings: (settings: Partial<Record<EditableSetting, string>>) =>
    request<{ settings: Record<EditableSetting, string> }>('/settings', send('PUT', { settings })),
  push: () => request<{ publicKey: string; devices: PushDevice[] }>('/push'),
  pushSubscribe: (subscription: PushSubscriptionJSON, device: string) => request<{ ok: true }>('/push/subscribe', send('POST', { subscription, device })),
  pushUnsubscribe: (endpoint: string) => request<{ ok: true }>('/push/unsubscribe', send('POST', { endpoint })),
  pushTest: (endpoint: string) => request<{ ok: true }>('/push/test', send('POST', { endpoint })),
  log: () => request<{ entries: { at: string; user: string; action: string; detail: string }[] }>('/log'),
}

export interface ProductBody {
  name: string
  description: string
  spiceLevel: number
  isVeg: boolean
  icon: string | null
  isActive: boolean
  sortOrder: number
}

export interface VariantBody {
  label: string
  pricePaise: number
  weightG: number | null
  stock: number | null
  isActive?: boolean
  sortOrder?: number
}

export interface ZoneBody {
  name: string
  pincodes: string
  feePaise: number
  allowsMeals: boolean
  isActive: boolean
}

export interface PushDevice {
  endpoint: string
  user: string
  device: string
  since: string
}
