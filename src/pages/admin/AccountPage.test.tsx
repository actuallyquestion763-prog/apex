import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AccountPage } from './AccountPage'
import { ToastProvider } from '../../components/Toast'
import { ApiError } from '../../lib/api'

const apiPost = vi.fn()
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, api: { post: (...args: unknown[]) => apiPost(...args) } }
})

const superAdminUser = {
  id: 'super-uid-1',
  email: 'super.admin@edgetrade.example',
  fullName: 'Super Admin',
  role: 'SUPER_ADMIN' as const,
}

vi.mock('../../store/auth', () => ({
  useAuth: () => ({ user: superAdminUser }),
}))

function renderAccount() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AccountPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('AdminAccountPage', () => {
  beforeEach(() => {
    apiPost.mockReset()
  })

  it("displays the authenticated admin's real login email — never hardcoded", () => {
    renderAccount()
    expect(screen.getByText('super.admin@edgetrade.example')).toBeInTheDocument()
    expect(screen.getByText('SUPER_ADMIN')).toBeInTheDocument()
  })

  it('rejects submission with an empty current password without calling the API', () => {
    renderAccount()
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpassword123' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))
    expect(apiPost).not.toHaveBeenCalled()
    expect(screen.getByText(/enter your current password/i)).toBeInTheDocument()
  })

  it('rejects a new password shorter than 8 characters without calling the API', () => {
    renderAccount()
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'oldpassword1' } })
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))
    expect(apiPost).not.toHaveBeenCalled()
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
  })

  it('rejects a mismatched confirmation without calling the API', () => {
    renderAccount()
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'oldpassword1' } })
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'somethingelse123' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))
    expect(apiPost).not.toHaveBeenCalled()
    expect(screen.getByText(/do not match/i)).toBeInTheDocument()
  })

  it('submits current and new password only — never a target user id — via the existing change-password endpoint', async () => {
    apiPost.mockResolvedValue({})
    renderAccount()
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'oldpassword1' } })
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpassword123' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/auth/change-password', {
      currentPassword: 'oldpassword1',
      newPassword: 'newpassword123',
    }))
    await waitFor(() => expect(screen.getByText(/other active sessions have been signed out/i)).toBeInTheDocument())
  })

  it('clears the form fields after a successful change', async () => {
    apiPost.mockResolvedValue({})
    renderAccount()
    const current = screen.getByLabelText(/current password/i) as HTMLInputElement
    const next = screen.getByLabelText(/^new password$/i) as HTMLInputElement
    fireEvent.change(current, { target: { value: 'oldpassword1' } })
    fireEvent.change(next, { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpassword123' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))
    await waitFor(() => expect(current.value).toBe(''))
    expect(next.value).toBe('')
  })

  it('surfaces the backend error (e.g. wrong current password) via toast and does not clear the form', async () => {
    apiPost.mockRejectedValue(new ApiError(401, 'Current password is incorrect.', null))
    renderAccount()
    const current = screen.getByLabelText(/current password/i) as HTMLInputElement
    fireEvent.change(current, { target: { value: 'wrongpassword' } })
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpassword123' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))
    await waitFor(() => expect(screen.getByText(/current password is incorrect/i)).toBeInTheDocument())
    expect(current.value).toBe('wrongpassword')
  })
})
