// Orders placed from this browser, so the status link isn't lost if the customer closes Instagram.

const KEY = 'mjk.orders.v1'

export interface RecentOrder {
  code: string
  key: string
  at: number
}

export function recentOrders(): RecentOrder[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function rememberOrder(code: string, key: string) {
  try {
    const list = [{ code, key, at: Date.now() }, ...recentOrders().filter((o) => o.code !== code)].slice(0, 5)
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* private mode */
  }
}
