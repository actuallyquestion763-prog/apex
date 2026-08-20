import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProfilePage } from './ProfilePage'

const signOut = vi.fn().mockResolvedValue(undefined)
const mockUser = {
  id: 'user-uid-12345',
  email: 'emmika@example.com',
  fullName: 'Emmika',
  country: 'Kenya',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  kycStatus: 'PENDING' as const,
  twoFactorEnabled: false,
  referralCode: 'CXAG8TGS',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: mockUser, signOut }),
}))

function renderProfile() {
  return render(<MemoryRouter><ProfilePage /></MemoryRouter>)
}

describe('ProfilePage', () => {
  beforeEach(() => {
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
})
