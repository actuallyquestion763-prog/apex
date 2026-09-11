import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useToast } from '../components/Toast'
import { Logo } from '../components/Logo'
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react'

export function VerifyEmailPage() {
  const { user, verifyEmail } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await verifyEmail(code)
    setLoading(false)
    if (!res.ok) {
      setError(res.error || 'Verification failed.')
      return
    }
    push('success', 'Email verified! Welcome to EDGETRADE.')
    navigate('/dashboard')
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/"><Logo size="lg" /></Link>
        </div>
        <div className="card p-8 text-center shadow-glow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-ocean-500/15 text-ocean-400">
            <Mail className="h-8 w-8" />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-white">Verify your email</h1>
          <p className="mt-2 text-sm text-slate-400">
            This demo does not send real emails. Enter any 6-digit code below to simulate verifying <span className="font-semibold text-white">{user?.email || 'your email'}</span>.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <input
              className="input text-center font-mono text-lg tracking-[0.5em]"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            {error && <p className="rounded-lg bg-bear/10 px-3 py-2 text-sm text-bear">{error}</p>}
            <button type="submit" disabled={loading} className="btn-gold w-full py-3">
              {loading ? 'Verifying…' : 'Verify email'} <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-bull" /> Tip: enter any 6 digits to simulate verification.
          </div>
          <button onClick={() => { setCode('123456') }} className="mt-3 text-xs text-ocean-400 hover:text-ocean-300">
            Autofill demo code
          </button>
        </div>
        <p className="mt-6 text-center text-sm text-slate-400">
          <Link to="/dashboard" className="font-semibold text-slate-300 hover:text-white">Skip for now</Link>
        </p>
      </div>
    </div>
  )
}
