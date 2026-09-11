import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StepUpModal } from './StepUpModal'

const baseUser = {
  id: 'admin-uid-1',
  email: 'admin@example.com',
  fullName: 'Admin',
  country: 'Kenya',
  role: 'SUPER_ADMIN' as const,
  status: 'ACTIVE' as const,
  kycStatus: 'VERIFIED' as const,
  referralCode: 'CXAG8TGS',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

let currentUser: typeof baseUser & { twoFactorEnabled: boolean } = { ...baseUser, twoFactorEnabled: false }

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: currentUser }),
}))

function renderModal(overrides: Partial<{ onConfirm: (...args: any[]) => Promise<void>; onClose: () => void; reasonRequired: boolean }> = {}) {
  const onConfirm = overrides.onConfirm ?? vi.fn().mockResolvedValue(undefined)
  const onClose = overrides.onClose ?? vi.fn()
  render(
    <MemoryRouter>
      <StepUpModal
        title="Update BTC receiving address"
        description="Changing a crypto receiving address is fund-safety-critical."
        reasonRequired={overrides.reasonRequired ?? true}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </MemoryRouter>,
  )
  return { onConfirm, onClose }
}

describe('StepUpModal', () => {
  beforeEach(() => {
    currentUser = { ...baseUser, twoFactorEnabled: false }
  })

  describe('admin without 2FA enabled', () => {
    it('never shows the password/authenticator form — it cannot be completed anyway', () => {
      currentUser = { ...baseUser, twoFactorEnabled: false }
      renderModal()
      expect(screen.queryByLabelText(/authenticator code/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument()
    })

    it('clearly explains 2FA is required and links to /2fa-setup', () => {
      currentUser = { ...baseUser, twoFactorEnabled: false }
      renderModal()
      expect(screen.getByText(/requires two-factor authentication/i)).toBeInTheDocument()
      const link = screen.getByRole('link', { name: /enable two-factor authentication/i })
      expect(link).toHaveAttribute('href', '/2fa-setup')
    })

    it('still shows the action-specific description so the admin knows what was blocked', () => {
      currentUser = { ...baseUser, twoFactorEnabled: false }
      renderModal()
      expect(screen.getByText('Changing a crypto receiving address is fund-safety-critical.')).toBeInTheDocument()
    })

    it('Cancel calls onClose without ever calling onConfirm', () => {
      currentUser = { ...baseUser, twoFactorEnabled: false }
      const { onClose, onConfirm } = renderModal()
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(onClose).toHaveBeenCalled()
      expect(onConfirm).not.toHaveBeenCalled()
    })
  })

  describe('admin with 2FA enabled', () => {
    it('shows the full reason + password + authenticator form, unchanged', () => {
      currentUser = { ...baseUser, twoFactorEnabled: true }
      renderModal()
      expect(screen.getByPlaceholderText(/why is this action being taken/i)).toBeInTheDocument()
      expect(screen.getByText(/your current password/i)).toBeInTheDocument()
      expect(screen.getByText(/^authenticator code$/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^confirm$/i })).toBeInTheDocument()
    })

    it('rejects submission with a missing authenticator code, without calling onConfirm', () => {
      currentUser = { ...baseUser, twoFactorEnabled: true }
      const { onConfirm } = renderModal()
      fireEvent.change(screen.getByPlaceholderText(/why is this action being taken/i), { target: { value: 'Rotating compromised wallet' } })
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      fireEvent.change(passwordInput, { target: { value: 'my-current-password' } })
      fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
      expect(onConfirm).not.toHaveBeenCalled()
      expect(screen.getByText(/enter your 6-digit authenticator code/i)).toBeInTheDocument()
    })

    it('submits reason, password, and a normalized 6-digit code to onConfirm when everything is filled in', async () => {
      currentUser = { ...baseUser, twoFactorEnabled: true }
      const { onConfirm } = renderModal()
      fireEvent.change(screen.getByPlaceholderText(/why is this action being taken/i), { target: { value: 'Rotating compromised wallet' } })
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      fireEvent.change(passwordInput, { target: { value: 'my-current-password' } })
      fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
        reason: 'Rotating compromised wallet',
        confirmPassword: 'my-current-password',
        totpCode: '123456',
      }))
    })

    it('strips non-digit characters from the authenticator code as it is typed', () => {
      currentUser = { ...baseUser, twoFactorEnabled: true }
      renderModal()
      const totpInput = screen.getByPlaceholderText('000000') as HTMLInputElement
      fireEvent.change(totpInput, { target: { value: '12 34-56' } })
      expect(totpInput.value).toBe('123456')
    })

    it('does not require a reason when reasonRequired is false', () => {
      currentUser = { ...baseUser, twoFactorEnabled: true }
      renderModal({ reasonRequired: false })
      expect(screen.queryByPlaceholderText(/why is this action being taken/i)).not.toBeInTheDocument()
    })
  })
})
