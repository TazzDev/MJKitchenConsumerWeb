import { useSyncExternalStore } from 'react'

const subscribe = (l: () => void) => {
  window.addEventListener('popstate', l)
  return () => window.removeEventListener('popstate', l)
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

export function navigate(path: string) {
  if (path === window.location.pathname) return
  window.history.pushState(null, '', path + window.location.search)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}
