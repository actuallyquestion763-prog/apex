import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useToast } from '../components/Toast'
import { Logo } from '../components/Logo'
import { ArrowRight, Mail, Lock } from 'lucide-react'

export function LoginPage() {
  const { signIn } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    const res = await signIn(form.email, form.password)
    setLoading(false)
    if (res.needs2fa) { push('info', 'Two-factor authentication required.'); navigate('/2fa-verify'); return }
    if (!res.ok) return setError(res.error || 'Sign in failed.')
    push('success', 'Welcome back!'); navigate('/dashboard')
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center"><Link to="/"><Logo size="lg" /></Link></div>
        <div className="card p-8 shadow-glow-sm">
          <h1 className="text-3xl font-extrabold text-white text-center">EDGETRADE</h1>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div><label className="label">Email address</label>
              <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input type="email" className="input pl-10" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label">Password</label>
                <Link to="/forgot-password" className="mb-1.5 text-xs text-slate-500 hover:text-white">Forgot password?</Link>
              </div>
              <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input type="password" className="input pl-10" placeholder="••••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
            </div>
            {error && <p className="rounded-lg bg-bear/10 px-3 py-2 text-sm text-bear">{error}</p>}
            <button type="submit" disabled={loading} className="btn-gold w-full py-3">{loading ? 'Signing in…' : 'Sign in'} <ArrowRight className="h-4 w-4" /></button>
          </form>
          <div className="mt-4 flex items-center justify-end text-xs">
            <Link to="/signup" className="text-slate-500 hover:text-white">Create account</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
