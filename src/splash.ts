// Hides the first-visit splash drawn by index.html. It is only shown once per browser, on the home page,
// and never with reduced motion (index.html decides that before anything else loads).
const MIN_MS = 2250 // the logo's entrance animation finishes at about 1.65 s, then it holds briefly
const MAX_MS = 3100 // after this the splash goes even if the menu hasn't loaded yet

let done = false

export function hideSplash() {
  const el = document.getElementById('splash')
  if (done || !el) return
  done = true
  if (!document.documentElement.classList.contains('splash')) {
    el.remove()
    return
  }
  try {
    localStorage.setItem('mjk.splash', '1')
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    el.classList.add('out')
    setTimeout(() => {
      el.remove()
      document.documentElement.classList.remove('splash')
    }, 300)
  }, Math.max(0, MIN_MS - performance.now()))
}

setTimeout(hideSplash, Math.max(0, MAX_MS - performance.now()))
