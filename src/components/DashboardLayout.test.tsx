import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardLayout } from './DashboardLayout'
import { I18nProvider } from '../i18n'

const baseUser = {
  id: 'user-uid-1',
  email: 'user@example.com',
  fullName: 'Regular User',
  country: 'Kenya',
  status: 'ACTIVE' as const,
  kycStatus: 'NOT_STARTED' as const,
  twoFactorEnabled: false,
  referralCode: 'ABCD1234',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const normalUser = { ...baseUser, role: 'USER' as const }
const adminUser = { ...baseUser, id: 'admin-uid-1', email: 'admin@example.com', role: 'ADMIN' as const }
const superAdminUser = { ...baseUser, id: 'super-uid-1', email: 'super@example.com', role: 'SUPER_ADMIN' as const }

let currentUser: typeof normalUser | typeof adminUser | typeof superAdminUser = normalUser

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: currentUser, signOut: vi.fn() }),
}))
vi.mock('../store/useStore', () => ({
  useCashBalance: () => ({ balance: null, loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('./NotificationBell', () => ({ NotificationBell: () => null }))
vi.mock('./LiveChat', () => ({ LiveChat: () => null }))
vi.mock('./PriceTicker', () => ({ PriceTicker: () => null }))
vi.mock('./AnnouncementBanner', () => ({ AnnouncementBanner: () => null }))
vi.mock('./BottomNav', () => ({ default: () => null }))

function renderLayout() {
  return render(<MemoryRouter><I18nProvider><DashboardLayout /></I18nProvider></MemoryRouter>)
}

describe('DashboardLayout (desktop top navigation)', () => {
  beforeEach(() => { currentUser = normalUser })

  it('renders exactly Home, Markets, Trade, Assets, Mine — mirroring BottomNav, no Options', () => {
    renderLayout()
    const labels = ['Home', 'Markets', 'Trade', 'Assets', 'Mine']
    for (const label of labels) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('Mine links to the profile page, where Wallet, Verification, and Support remain reachable', () => {
    renderLayout()
    expect(screen.getByRole('link', { name: 'Mine' })).toHaveAttribute('href', '/profile')
  })

  it('never renders an Options nav item or a link to /options for a normal user', () => {
    renderLayout()
    expect(screen.queryByText('Options')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Options' })).not.toBeInTheDocument()
  })

  // TRUST authorization/UI fix — a plain USER must never see the Admin nav
  // item, using the real authenticated user's role from auth/session state
  // (mocked here via useAuth — never derived from the URL or CSS).
  it('does not show the Admin nav link for a normal USER', () => {
    currentUser = normalUser
    renderLayout()
    expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument()
  })

  it('shows the Admin nav link, pointing at /admin, for an ADMIN user', () => {
    currentUser = adminUser
    renderLayout()
    const link = screen.getByRole('link', { name: /admin/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/admin')
  })

  it('shows the Admin nav link, pointing at /admin, for a SUPER_ADMIN user', () => {
    currentUser = superAdminUser
    renderLayout()
    const link = screen.getByRole('link', { name: /admin/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/admin')
  })

  it('no longer shows a Support icon in the top-nav header — it moved to a floating button', () => {
    renderLayout()
    expect(within(screen.getByRole('banner')).queryByRole('link', { name: 'Support' })).not.toBeInTheDocument()
  })

  it('renders the floating Support button, linking to /support', () => {
    renderLayout()
    const link = screen.getByRole('link', { name: 'Support' })
    expect(link).toHaveAttribute('href', '/support')
  })
})
