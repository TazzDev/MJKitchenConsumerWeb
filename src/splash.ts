// Runs the first-visit splash drawn by index.html. It is only shown once per browser, on the home page,
// and never with reduced motion (index.html decides that before anything else loads; ?splash forces it).
// Instagram and Chrome can load a page in the background before anyone looks at it, so the splash
// only starts counting, and only marks itself as seen, once the page is actually on screen.
const MIN_MS = 2250 // the logo's entrance animation finishes at about 1.65 s, then it holds briefly
const MAX_MS = 3100 // after this the splash goes even if the menu hasn't loaded yet

const onScreen = () => !document.hidden && !(document as Document & { prerendering?: boolean }).prerendering

let el = document.getElementById('splash')
let shownAt = -1 // performance.now() when the visitor first saw it
let ready = false
let leaving = false

function leave() {
  if (leaving || !el) return
  leaving = true
  try {
    localStorage.setItem('mjk.splash', '1')
  } catch {
    /* ignore */
  }
  const splash = el
  splash.classList.add('out')
  setTimeout(() => {
    splash.remove()
    document.documentElement.classList.remove('splash')
  }, 300)
}

function schedule() {
  if (shownAt < 0) return
  const now = performance.now()
  if (ready) setTimeout(leave, Math.max(0, shownAt + MIN_MS - now))
}

function show(restart: boolean) {
  if (!el) return
  if (restart) {
    // Its animations may already have played out while the page was hidden: start them again.
    const fresh = el.cloneNode(true) as HTMLElement
    el.replaceWith(fresh)
    el = fresh
  }
  shownAt = restart ? performance.now() : 0
  setTimeout(leave, Math.max(0, shownAt + MAX_MS - performance.now()))
  schedule()
}

if (el && !document.documentElement.classList.contains('splash')) {
  el.remove()
  el = null
} else if (el) {
  if (onScreen()) show(false)
  else {
    const check = () => {
      if (!onScreen()) return
      document.removeEventListener('visibilitychange', check)
      document.removeEventListener('prerenderingchange', check)
      show(true)
    }
    document.addEventListener('visibilitychange', check)
    document.addEventListener('prerenderingchange', check)
  }
}

// Called once there is something to show under the splash (the menu, an error, or another page).
export function hideSplash() {
  if (ready) return
  ready = true
  schedule()
}
