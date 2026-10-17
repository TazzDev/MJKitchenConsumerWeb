// Instagram (and Facebook) open links in their own built-in browser. It can't
// download files, often blocks the clipboard API, and may not hand payment-app
// links to the app, so the payment page checks for it and offers a way out.

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent

export const inApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS/.test(ua)
export const isAndroid = /Android/i.test(ua)
export const isIOS = /iPhone|iPad|iPod/.test(ua)

/** Which browser "Open in browser" leads to, for button labels. */
export const browserName = isIOS ? 'Safari' : 'Chrome'

/**
 * A link that leaves the in-app browser for the phone's own browser, or null
 * where there's no such link and the visitor has to use Instagram's ••• menu.
 * Android: an intent link for Chrome. iPhone (iOS 17+): Safari's own scheme.
 */
export function openInBrowserLink(url = window.location.href): string | null {
  const u = new URL(url)
  if (isAndroid) {
    const fallback = encodeURIComponent(u.href)
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`
  }
  if (isIOS) return `x-safari-${u.href}`
  return null
}

/**
 * Copies text, falling back to the old execCommand route that in-app browsers
 * still allow. Resolves false if nothing worked, so the caller can show the text.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* blocked or missing: try the old way */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}
