import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-serif-display/latin-400.css'
import '@fontsource-variable/montserrat'
import '@fontsource/allura/latin-400.css'
import './index.css'
import { App } from './App'

// iOS Safari (and Instagram's browser on iPhone) only shows :active press styles when a touch listener exists.
document.addEventListener('touchstart', () => {}, { passive: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
