import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProfilePage } from './ProfilePage'
import { I18nProvider } from '../i18n'

const signOut = vi.fn().mockResolvedValue(undefined)
const baseUser = {
  id: 'user-uid-12345',
  email: 'emmika@example.com',
  fullName: 'Emmika',
  country: 'Kenya',
  status: 'ACTIVE' as const,
  kycStatus: 'PENDING' as const,
  twoFactorEnabled: false,
  referralCode: 'CXAG8TGS',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const mockUser = { ...baseUser, role: 'USER' as const }
const adminUser = { ...baseUser, id: 'admin-uid-1', email: 'admin@example.com', role: 'ADMIN' as const }
const superAdminUser = { ...baseUser, id: 'super-uid-1', email: 'super@example.com', role: 'SUPER_ADMIN' as const }

let currentUser: typeof mockUser | typeof adminUser | typeof superAdminUser = mockUser

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: currentUser, signOut }),
}))

function renderProfile() {
  return render(<MemoryRouter><I18nProvider><ProfilePage /></I18nProvider></MemoryRouter>)
}

describe('ProfilePage', () => {
  beforeEach(() => {
    currentUser = mockUser
    signOut.mockClear()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('displays the authenticated user\'s real name, UID, and referral code — never hardcoded', () => {
    renderProfile()
    expect(screen.getByText('Emmika')).toBeInTheDocument()
    expect(screen.getByText(/UID: user-uid-12345/)).toBeInTheDocument()
    expect(screen.getByText('CXAG8TGS')).toBeInTheDocument()
  })

  it('copies the real referral code to the clipboard and shows "Copied!" feedback', async () => {
    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('CXAG8TGS')
    await waitFor(() => expect(screen.getByText('Copied!')).toBeInTheDocument())
  })

  it('renders Deposit and Withdraw quick actions linking to the existing pages', () => {
    renderProfile()
    expect(screen.getByRole('link', { name: /deposit/i })).toHaveAttribute('href', '/deposit')
    expect(screen.getByRole('link', { name: /withdraw/i })).toHaveAttribute('href', '/withdraw')
  })

  it('renders the account menu: Transaction Records, KYC, Security, Languages, About', () => {
    renderProfile()
    expect(screen.getByRole('link', { name: /transaction records/i })).toHaveAttribute('href', '/wallet')
    expect(screen.getByRole('link', { name: /^kyc/i })).toHaveAttribute('href', '/kyc')
    expect(screen.getByRole('link', { name: /security/i })).toHaveAttribute('href', '/security')
    expect(screen.getByRole('link', { name: /languages/i })).toHaveAttribute('href', '/languages')
    expect(screen.getByRole('link', { name: /about/i })).toHaveAttribute('href', '/about')
  })

  it('never shows a Bank Accounts menu item', () => {
    renderProfile()
    expect(screen.queryByText(/bank account/i)).not.toBeInTheDocument()
  })

  it('shows the KYC status without relying on color alone (icon + text label)', () => {
    renderProfile()
    expect(screen.getAllByText('Verification pending').length).toBeGreaterThanOrEqual(1)
  })

  it('logs out via the real session mechanism when Log out is clicked', async () => {
    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: /log out/i }))
    await waitFor(() => expect(signOut).toHaveBeenCalled())
  })

  // TRUST authorization/UI fix — same fail-closed role check as
  // DashboardLayout's top nav (src/lib/roles.ts), verified independently
  // here since ProfilePage has its own separate "Admin panel" menu item.
  it('does not show an Admin panel menu item for a normal USER', () => {
    currentUser = mockUser
    renderProfile()
    expect(screen.queryByRole('link', { name: /admin panel/i })).not.toBeInTheDocument()
  })

  it('shows the Admin panel menu item, linking to /admin, for an ADMIN user', () => {
    currentUser = adminUser
    renderProfile()
    expect(screen.getByRole('link', { name: /admin panel/i })).toHaveAttribute('href', '/admin')
  })

  it('shows the Admin panel menu item, linking to /admin, for a SUPER_ADMIN user', () => {
    currentUser = superAdminUser
    renderProfile()
    expect(screen.getByRole('link', { name: /admin panel/i })).toHaveAttribute('href', '/admin')
  })
})
