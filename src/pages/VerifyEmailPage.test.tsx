import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VerifyEmailPage } from './VerifyEmailPage'
import { ToastProvider } from '../components/Toast'

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: { email: 'demo@example.com' }, verifyEmail: vi.fn().mockResolvedValue({ ok: true }) }),
}))

function renderPage() {
  return render(<MemoryRouter><ToastProvider><VerifyEmailPage /></ToastProvider></MemoryRouter>)
}

describe('VerifyEmailPage — no false "we sent a code" claim (Phase G)', () => {
  it('never claims an email was actually sent, since no email-sending mechanism exists', () => {
    renderPage()
    expect(screen.queryByText(/we sent a 6-digit verification code/i)).not.toBeInTheDocument()
  })

  it('honestly discloses this is a simulated, no-email demo step', () => {
    renderPage()
    expect(screen.getByText(/does not send real emails/i)).toBeInTheDocument()
  })
})
