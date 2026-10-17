import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // `npm run dev` serves the front end only; run `wrangler pages dev` on 8788 for the API.
    proxy: { '/api': 'http://localhost:8788' },
  },
})
