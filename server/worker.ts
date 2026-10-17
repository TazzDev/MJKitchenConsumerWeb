// Cloudflare Worker entry. Static files in dist/ are served by Workers Static Assets;
// only /api/* reaches this code (see run_worker_first in wrangler.toml).
import app from './app'
import type { Env } from './db'
import { expireOrders, maybeSendKitchenSheet } from './orders'

export default {
  fetch: app.fetch,
  // Cron Trigger (see [triggers] in wrangler.toml): every 15 minutes.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const expired = await expireOrders(env)
        const sheet = await maybeSendKitchenSheet(env)
        if (expired || sheet) console.log(`cron: expired ${expired} orders${sheet ? `, kitchen sheet sent for ${sheet}` : ''}`)
      })(),
    )
  },
} satisfies ExportedHandler<Env>
