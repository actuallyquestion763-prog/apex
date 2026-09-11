import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useToast } from '../components/Toast'
import { Logo } from '../components/Logo'
import { ArrowRight, KeyRound } from 'lucide-react'

export function TwoFactorVerifyPage() {
  const { confirm2fa } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await confirm2fa(code)
    if (!res.ok) {
      setError(res.error || 'Verification failed.')
      return
    }
    push('success', 'Authentication successful.')
    navigate('/dashboard')
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/"><Logo size="lg" /></Link>
        </div>
        <div className="card p-8 text-center shadow-glow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gold-500/15 text-gold-400">
            <KeyRound className="h-8 w-8" />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-white">Two-factor authentication</h1>
          <p className="mt-2 text-sm text-slate-400">Enter the 6-digit code from your authenticator app to continue.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <input className="input text-center font-mono text-lg tracking-[0.5em]" placeholder="000000" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            {error && <p className="rounded-lg bg-bear/10 px-3 py-2 text-sm text-bear">{error}</p>}
            <button type="submit" className="btn-gold w-full py-3">Verify <ArrowRight className="h-4 w-4" /></button>
          </form>
        </div>
      </div>
    </div>
  )
}
