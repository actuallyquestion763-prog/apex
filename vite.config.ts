import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
      // Legacy standalone market proxy (server/market.js) — kept for now,
      // no longer used by the frontend (which now goes through /api/markets
      // instead), but not deleted since it still works standalone.
      '/market': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        secure: false,
      }
    }
  },
})
