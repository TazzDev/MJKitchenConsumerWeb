import { useSyncExternalStore } from 'react'

const subscribe = (l: () => void) => {
  window.addEventListener('popstate', l)
  return () => window.removeEventListener('popstate', l)
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

/** Go to `path`, keeping the current query string unless `path` brings its own. */
export function navigate(path: string, { replace = false } = {}) {
  if (path === window.location.pathname) return
  const url = path.includes('?') ? path : path + window.location.search
  if (replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}
