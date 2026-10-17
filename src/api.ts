import type { CreateOrderRequest, CreateOrderResponse, OrderView } from './shared/orders'
import type { MenuResponse, Problem, Quote, QuoteRequest } from './shared/types'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public problems: Problem[] = [],
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const json = typeof init?.body === 'string'
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: json ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers })
  } catch {
    throw new ApiError('Could not reach MJ Kitchen. Check your connection and try again.', 0)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const b = body as { error?: string; problems?: Problem[] }
    throw new ApiError(b.error ?? 'Could not reach MJ Kitchen. Check your connection and try again.', res.status, b.problems ?? [])
  }
  return body as T
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const orderPath = (code: string, key: string, rest = '') => `/api/orders/${encodeURIComponent(code)}${rest}?k=${encodeURIComponent(key)}`

export const getMenu = () => request<MenuResponse>('/api/menu')
export const getQuote = (req: QuoteRequest) => request<Quote>('/api/quote', post(req))
export const createOrder = (req: CreateOrderRequest) => request<CreateOrderResponse>('/api/orders', post(req))
export const getOrder = (code: string, key: string) => request<OrderView>(orderPath(code, key))
export const submitPayment = (code: string, key: string, form: FormData) =>
  request<OrderView>(orderPath(code, key, '/payment'), { method: 'POST', body: form })
export const findOrder = (code: string, phone: string) => request<CreateOrderResponse>('/api/orders/find', post({ code, phone }))
