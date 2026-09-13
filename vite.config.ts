/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Checkpoint J — this project had no frontend test infrastructure before
  // this checkpoint (backend-only historically). Vitest is Vite-native (zero
  // separate build config, reuses this same file/plugins) and a dev
  // dependency only — it never ships in the production bundle built by
  // `vite build`, so it has no effect on the numbers reported in Part 18.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Scoped to the frontend only — backend/ has its own separate Jest
    // suite (backend/test/jest-e2e.json, backend/package.json's "test"
    // script) using Jest-specific globals (jest.fn()) that don't exist
    // under Vitest; without this, Vitest's default discovery pattern picks
    // up those files too and every one of them fails with
    // "ReferenceError: jest is not defined".
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  server: { port: 5173, host: true,
    proxy: {
      // TRUST secure backend (backend/) — authentication, balances, ledger,
      // orders, positions, deposits, withdrawals, KYC status, admin, and
      // (as of this phase) market data too. See src/lib/api.ts.
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
        secure: false,
        // Backend routes have no /api prefix (e.g. POST /auth/login, not
        // POST /api/auth/login) — strip it here so src/lib/api.ts can keep
        // using /api/... paths on the frontend side.
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Legacy standalone market proxy (server/market.js, routes like
      // /market/xau) — kept for now, no longer used by the frontend (which
      // now goes through /api/markets instead), but not deleted since it
      // still works standalone. Trailing slash is deliberate: a bare
      // '/market' prefix-matches '/markets' too (Vite's proxy match is a
      // plain string prefix), which hijacked every request to the app's
      // OWN /markets page route — including a hard refresh or direct link
      // — and 500'd it against this proxy's dead port 4001 target instead
      // of serving the SPA. '/market/' still matches every real legacy
      // route (all of which have a path segment after it) without
      // colliding with '/markets'.
      '/market/': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        secure: false,
      }
    }
  },
})
