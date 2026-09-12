import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StepUpModal } from './StepUpModal'
import { ApiError } from '../lib/api'

function renderModal(overrides: Partial<{ onConfirm: (...args: any[]) => Promise<void>; onClose: () => void; reasonRequired: boolean }> = {}) {
  const onConfirm = overrides.onConfirm ?? vi.fn().mockResolvedValue(undefined)
  const onClose = overrides.onClose ?? vi.fn()
  render(
    <StepUpModal
      title="Update BTC receiving address"
      description="Changing a crypto receiving address is fund-safety-critical."
      reasonRequired={overrides.reasonRequired ?? true}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  )
  return { onConfirm, onClose }
}

// Password-only re-authentication for every admin step-up action, by
// explicit product decision — there is no TOTP/authenticator field anywhere
// in this component, and no "enable 2FA first" blocking state. Ordinary
// account 2FA (setup/login) is unrelated and lives elsewhere entirely.
describe('StepUpModal', () => {
  it('shows the reason + password form — no authenticator/TOTP field anywhere', () => {
    renderModal()
    expect(screen.getByPlaceholderText(/why is this action being taken/i)).toBeInTheDocument()
    expect(screen.getByText(/your current password/i)).toBeInTheDocument()
    expect(screen.queryByText(/authenticator/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/two-factor/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('000000')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeInTheDocument()
  })

  it('shows the action-specific description', () => {
    renderModal()
    expect(screen.getByText('Changing a crypto receiving address is fund-safety-critical.')).toBeInTheDocument()
  })

  it('rejects submission with a missing reason, without calling onConfirm', () => {
    const { onConfirm } = renderModal()
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(passwordInput, { target: { value: 'my-current-password' } })
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText(/enter a reason/i)).toBeInTheDocument()
  })

  it('rejects submission with a missing password, without calling onConfirm', () => {
    const { onConfirm } = renderModal()
    fireEvent.change(screen.getByPlaceholderText(/why is this action being taken/i), { target: { value: 'Manual credit per support ticket #123' } })
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText(/enter your current password/i)).toBeInTheDocument()
  })

  it('submits reason + password only — never a totpCode field — when both are filled in', async () => {
    const { onConfirm } = renderModal()
    fireEvent.change(screen.getByPlaceholderText(/why is this action being taken/i), { target: { value: 'Manual credit per support ticket #123' } })
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(passwordInput, { target: { value: 'my-current-password' } })
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    // toHaveBeenCalledWith asserts the exact object shape — an extra
    // totpCode property would fail this just as much as a missing one.
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      reason: 'Manual credit per support ticket #123',
      confirmPassword: 'my-current-password',
    }))
  })

  it('does not require a reason when reasonRequired is false', () => {
    renderModal({ reasonRequired: false })
    expect(screen.queryByPlaceholderText(/why is this action being taken/i)).not.toBeInTheDocument()
  })

  it('surfaces the backend\'s exact rejection message (e.g. wrong password) via the error banner', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(401, 'Re-authentication failed: incorrect password.', null))
    renderModal({ onConfirm })
    fireEvent.change(screen.getByPlaceholderText(/why is this action being taken/i), { target: { value: 'Test' } })
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(passwordInput, { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    await waitFor(() => expect(screen.getByText(/incorrect password/i)).toBeInTheDocument())
  })

  it('Close (header X) calls onClose without ever calling onConfirm', () => {
    const { onClose, onConfirm } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
