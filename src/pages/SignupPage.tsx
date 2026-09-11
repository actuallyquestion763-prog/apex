import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useToast } from '../components/Toast'
import { Logo } from '../components/Logo'
import { ArrowRight, Mail, Lock, User, Globe, Check } from 'lucide-react'

export function SignupPage() {
  const { signUp } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', confirm: '', fullName: '', country: '', referralCode: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    if (form.password.length < 8) return setError('Password must be at least 8 characters.')
    setLoading(true)
    const res = await signUp(form)
    setLoading(false)
    if (!res.ok) return setError(res.error || 'Sign up failed.')
    push('success', 'Account created! Welcome to EDGETRADE.')
    navigate('/dashboard')
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center"><Link to="/"><Logo size="lg" /></Link></div>
        <div className="card p-8 shadow-glow-sm">
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-slate-400">Create your account, then deposit to fund it.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div><label className="label">Full name</label>
              <div className="relative"><User className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input className="input pl-10" placeholder="Jane Doe" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
            </div>
            <div><label className="label">Email address</label>
              <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input type="email" className="input pl-10" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
            </div>
            <div><label className="label">Country</label>
              <div className="relative"><Globe className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input className="input pl-10" placeholder="United States" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} required /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="label">Password</label>
                <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input type="password" className="input pl-10" placeholder="••••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
              </div>
              <div><label className="label">Confirm</label>
                <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input type="password" className="input pl-10" placeholder="••••••••" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required /></div>
              </div>
            </div>
            <div><label className="label">Referral code (optional)</label>
              <input className="input" placeholder="e.g. JANE1234" value={form.referralCode} onChange={(e) => setForm({ ...form, referralCode: e.target.value })} />
            </div>
            {error && <p className="rounded-lg bg-bear/10 px-3 py-2 text-sm text-bear">{error}</p>}
            <button type="submit" disabled={loading} className="btn-gold w-full py-3">{loading ? 'Creating account…' : 'Create account'} <ArrowRight className="h-4 w-4" /></button>
          </form>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Check className="h-3.5 w-3.5 text-bull" /> By signing up you agree to our Terms and Privacy Policy.</div>
        </div>
        <p className="mt-6 text-center text-sm text-slate-400">Already have an account? <Link to="/login" className="font-semibold text-gold-400 hover:text-gold-300">Sign in</Link></p>
      </div>
    </div>
  )
}
