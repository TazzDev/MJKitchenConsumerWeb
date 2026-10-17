// Cloudflare Worker entry. Static files in dist/ are served by Workers Static Assets;
// only /api/* reaches this code (see run_worker_first in wrangler.toml).
import app from './app'

export default app
