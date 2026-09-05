import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { I18nProvider } from './i18n'

const normalUser = {
  id: 'user-uid-1',
  email: 'user@example.com',
  fullName: 'Regular User',
  country: 'Kenya',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  kycStatus: 'NOT_STARTED' as const,
  twoFactorEnabled: false,
  referralCode: 'ABCD1234',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const adminUser = { ...normalUser, id: 'admin-uid-1', email: 'admin@example.com', role: 'ADMIN' as const, kycStatus: 'VERIFIED' as const }
const superAdmin = { ...normalUser, id: 'superadmin-uid-1', email: 'superadmin@example.com', role: 'SUPER_ADMIN' as const, kycStatus: 'VERIFIED' as const }

let currentUser: typeof normalUser | typeof adminUser | typeof superAdmin = normalUser

vi.mock('./store/auth', () => ({
  useAuth: () => ({ user: currentUser, loading: false, signOut: vi.fn() }),
}))
vi.mock('./store/useStore', () => ({
  useCashBalance: () => ({ balance: null, loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('./components/NotificationBell', () => ({ NotificationBell: () => null }))
vi.mock('./components/LiveChat', () => ({ LiveChat: () => null }))
vi.mock('./components/PriceTicker', () => ({ PriceTicker: () => null }))
vi.mock('./components/AnnouncementBanner', () => ({ AnnouncementBanner: () => null }))
vi.mock('./components/BottomNav', () => ({ default: () => null }))
vi.mock('./pages/TradePage', () => ({ default: () => <div>Trade Page Mock — Spot Trading still reachable</div> }))
vi.mock('./pages/admin/AdminDashboardPage', () => ({ AdminDashboardPage: () => <div>Admin Dashboard Mock — Options Trading lives under the Trading card, untouched by this change</div> }))
vi.mock('./pages/HomePage', () => ({ default: () => <div>Home Page Mock</div> }))

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><I18nProvider><App /></I18nProvider></MemoryRouter>)
}

describe('App routing — Options removed from normal-user access', () => {
  beforeEach(() => { currentUser = normalUser })

  it('redirects a normal user hitting /options to /trade instead of rendering the Options page', async () => {
    renderAt('/options')
    expect(await screen.findByText('Trade Page Mock — Spot Trading still reachable')).toBeInTheDocument()
  })

  it('still serves Spot Trade normally at /trade for a normal user', () => {
    renderAt('/trade')
    expect(screen.getByText('Trade Page Mock — Spot Trading still reachable')).toBeInTheDocument()
  })

  it('Super Admin can still reach the Admin dashboard (which links to the Trading controls) at /admin', () => {
    currentUser = superAdmin
    renderAt('/admin')
    expect(screen.getByText(/Admin Dashboard Mock/)).toBeInTheDocument()
  })

  it('a normal user hitting /admin is redirected away, never reaching the admin dashboard', async () => {
    currentUser = normalUser
    renderAt('/admin')
    expect(await screen.findByText('Home Page Mock')).toBeInTheDocument()
    expect(screen.queryByText(/Admin Dashboard Mock/)).not.toBeInTheDocument()
  })

  // TRUST authorization/UI fix — plain ADMIN (not just SUPER_ADMIN) must
  // also still reach the Admin dashboard; this guards against a regression
  // where the allow-list check only matched SUPER_ADMIN.
  it('a plain ADMIN can also reach the Admin dashboard at /admin', () => {
    currentUser = adminUser
    renderAt('/admin')
    expect(screen.getByText(/Admin Dashboard Mock/)).toBeInTheDocument()
  })

  // The AdminOnly guard wraps the PARENT /admin route, so every nested
  // child route inherits it — proving this for one representative nested
  // route (rather than only the /admin index) guards against a regression
  // where only the dashboard itself was protected.
  it('a normal user hitting a nested admin route (/admin/users) is redirected away too', async () => {
    currentUser = normalUser
    renderAt('/admin/users')
    expect(await screen.findByText('Home Page Mock')).toBeInTheDocument()
    expect(screen.queryByText(/Admin Dashboard Mock/)).not.toBeInTheDocument()
  })
})
