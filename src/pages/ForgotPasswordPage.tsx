// Forgot Password — Part 2. Reuses the exact same customer-facing design
// system as LoginPage (Logo, .card, .label, .input, .btn-gold) rather than
// inventing new styling. Always shows the same generic success state
// regardless of whether the email belongs to an account (Part 3) — this
// page never learns, and must never imply, whether an account exists.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { ArrowLeft, ArrowRight, Mail, MailCheck } from 'lucide-react'

export function ForgotPasswordPage() {
  const { push } = useToast()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { push('error', 'Enter your email address.'); return }
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setSent(true)
    } catch (err) {
      push('error', err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center"><Link to="/"><Logo size="lg" /></Link></div>
        <div className="card p-8 shadow-glow-sm">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bull/10 text-bull"><MailCheck className="h-6 w-6" /></div>
              <h1 className="mt-4 text-xl font-extrabold text-white">Check your email</h1>
              <p className="mt-2 text-sm text-slate-400">If an account exists for that email, a password reset link has been sent.</p>
              <Link to="/login" className="btn-gold mt-6 w-full py-3">Back to Login</Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-extrabold text-white text-center">Forgot password?</h1>
              <p className="mt-2 text-center text-sm text-slate-400">Enter your account email and we'll send you a link to reset your password.</p>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label className="label">Email address</label>
                  <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input type="email" className="input pl-10" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                </div>
                <button type="submit" disabled={loading} className="btn-gold w-full py-3">{loading ? 'Sending…' : 'Send Reset Link'} <ArrowRight className="h-4 w-4" /></button>
              </form>
              <div className="mt-4 flex items-center justify-center text-xs">
                <Link to="/login" className="flex items-center gap-1 text-slate-500 hover:text-white"><ArrowLeft className="h-3 w-3" /> Back to Login</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
