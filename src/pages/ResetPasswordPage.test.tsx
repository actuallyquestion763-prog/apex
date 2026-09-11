import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ResetPasswordPage } from './ResetPasswordPage'
import { ToastProvider } from '../components/Toast'
import { ApiError } from '../lib/api'

const apiPost = vi.fn()
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, api: { post: (...args: unknown[]) => apiPost(...args) } }
})

function renderReset(path = '/reset-password?token=real-token-abc123') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    apiPost.mockReset()
  })

  it('renders the reset form when a token is present in the URL', () => {
    renderReset()
    expect(screen.getByText('Reset your password')).toBeInTheDocument()
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument()
  })

  it('shows an invalid-link state and never submits when no token is present', () => {
    renderReset('/reset-password')
    expect(screen.getByText(/invalid reset link/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password')
  })

  it('rejects a new password shorter than 8 characters without calling the API', () => {
    renderReset()
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('rejects mismatched password confirmation without calling the API', () => {
    renderReset()
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'a-new-password' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'different-password' } })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('submits the token from the URL and the new password, then shows a success state with a Back to Login button', async () => {
    apiPost.mockResolvedValue({ ok: true })
    renderReset('/reset-password?token=real-token-abc123')
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'a-new-password' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'a-new-password' } })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/auth/reset-password', { token: 'real-token-abc123', newPassword: 'a-new-password' }))
    await waitFor(() => expect(screen.getByText(/password reset successfully/i)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /back to login/i })).toHaveAttribute('href', '/login')
    // Never auto-authenticates — no session/user state is touched by this page.
    expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument()
  })

  it('shows the backend\'s distinct message for an expired token', async () => {
    apiPost.mockRejectedValue(new ApiError(400, 'This password reset link has expired. Please request a new one.', null))
    renderReset()
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'a-new-password' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'a-new-password' } })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
    await waitFor(() => expect(screen.getByText(/has expired/i)).toBeInTheDocument())
  })

  it('shows the backend\'s distinct message for an already-used token', async () => {
    apiPost.mockRejectedValue(new ApiError(400, 'This password reset link has already been used.', null))
    renderReset()
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'a-new-password' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'a-new-password' } })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
    await waitFor(() => expect(screen.getByText(/already been used/i)).toBeInTheDocument())
  })

  it('shows the backend\'s distinct message for an invalid token', async () => {
    apiPost.mockRejectedValue(new ApiError(400, 'This password reset link is invalid.', null))
    renderReset()
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'a-new-password' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'a-new-password' } })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
    await waitFor(() => expect(screen.getByText(/reset link is invalid/i)).toBeInTheDocument())
  })

  it('never renders a currentPassword field — reset never requires the old password', () => {
    renderReset()
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument()
  })
})
