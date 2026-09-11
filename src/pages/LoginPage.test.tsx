import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from './LoginPage'
import { ToastProvider } from '../components/Toast'

vi.mock('../store/auth', () => ({
  useAuth: () => ({ signIn: vi.fn().mockResolvedValue({ ok: false, error: 'Invalid credentials.' }) }),
}))

function renderLogin() {
  return render(<MemoryRouter><ToastProvider><LoginPage /></ToastProvider></MemoryRouter>)
}

describe('LoginPage — real "Forgot password?" link to the recovery flow', () => {
  it('shows a "Forgot password?" link to /forgot-password', () => {
    renderLogin()
    const link = screen.getByText('Forgot password?')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/forgot-password')
  })

  it('still shows the real "Create account" link to /signup', () => {
    renderLogin()
    const link = screen.getByText('Create account')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/signup')
  })
})
