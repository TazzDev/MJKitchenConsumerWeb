// Cloudflare Turnstile bot check for Place order. Off until the
// turnstile_site_key setting is filled in (see docs/cloudflare-setup.md).
import { useEffect, useRef, useState } from 'react'

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  reset(id: string): void
  remove(id: string): void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
    s.onerror = () => {
      loading = null
      reject(new Error('turnstile'))
    }
    document.head.appendChild(s)
  })
  return loading
}

/** Renders the widget into the returned ref; `token` is null until the check passes. */
export function useTurnstile(siteKey: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  // In-app browsers sometimes can't run the check; say so instead of waiting forever.
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!siteKey || !ref.current) return
    let gone = false
    loadTurnstile().then(
      (ts) => {
        if (gone || !ref.current) return
        widget.current = ts.render(ref.current, {
          sitekey: siteKey,
          action: 'order',
          appearance: 'interaction-only',
          callback: (t: string) => {
            setToken(t)
            setFailed(false)
          },
          'expired-callback': () => setToken(null),
          'error-callback': () => {
            setToken(null)
            setFailed(true)
          },
        })
      },
      () => !gone && setFailed(true),
    )
    return () => {
      gone = true
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [siteKey, attempt])

  const reset = () => {
    setToken(null)
    setFailed(false)
    if (widget.current) window.turnstile?.reset(widget.current)
    else setAttempt((n) => n + 1) // the script never loaded: try again
  }
  return { ref, token, reset, failed: failed && !token, enabled: Boolean(siteKey) }
}
