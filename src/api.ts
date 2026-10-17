import type { MenuResponse, Quote, QuoteRequest } from './shared/types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Could not reach MJ Kitchen. Check your connection and try again.')
  return body as T
}

export const getMenu = () => request<MenuResponse>('/api/menu')
export const getQuote = (req: QuoteRequest) => request<Quote>('/api/quote', { method: 'POST', body: JSON.stringify(req) })
