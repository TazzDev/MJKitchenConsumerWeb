import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Two pages: the storefront, and the admin app at /admin/ (its own bundle,
    // so customers never download admin code).
    rollupOptions: { input: { main: 'index.html', admin: 'admin/index.html' } },
  },
  server: {
    // `npm run dev` serves the front end only; run `wrangler dev` on 8787 for the API.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
