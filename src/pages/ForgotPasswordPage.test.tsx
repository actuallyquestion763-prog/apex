import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { ToastProvider } from '../components/Toast'
import { ApiError } from '../lib/api'

const apiPost = vi.fn()
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, api: { post: (...args: unknown[]) => apiPost(...args) } }
})

function renderForgot() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ForgotPasswordPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    apiPost.mockReset()
  })

  it('renders the EDGETRADE-styled forgot password form', () => {
    renderForgot()
    expect(screen.getByText('Forgot password?')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument()
  })

  it('rejects submission with an empty email without calling the API', () => {
    renderForgot()
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('the email input enforces type="email" validation', () => {
    renderForgot()
    const input = screen.getByPlaceholderText('you@example.com') as HTMLInputElement
    expect(input.type).toBe('email')
    expect(input.required).toBe(true)
  })

  it('calls POST /auth/forgot-password with the entered email', async () => {
    apiPost.mockResolvedValue({ message: 'If an account exists for that email, a password reset link has been sent.' })
    renderForgot()
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/auth/forgot-password', { email: 'user@example.com' }))
  })

  it('shows the same generic success message regardless of what the backend actually did', async () => {
    apiPost.mockResolvedValue({ message: 'ok' })
    renderForgot()
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'anyone@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))
    await waitFor(() => expect(screen.getByText(/if an account exists for that email/i)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /back to login/i })).toHaveAttribute('href', '/login')
  })

  it('shows a network/error toast without ever claiming success on failure', async () => {
    apiPost.mockRejectedValue(new ApiError(0, 'Could not reach the server. Check your connection and try again.', null))
    renderForgot()
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument())
    expect(screen.queryByText(/if an account exists for that email/i)).not.toBeInTheDocument()
  })

  it('links back to /login', () => {
    renderForgot()
    const link = screen.getByText(/back to login/i)
    expect(link.closest('a')).toHaveAttribute('href', '/login')
  })
})
