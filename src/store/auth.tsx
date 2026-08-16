import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '../types'
import { api, ApiError } from '../lib/api'

interface AuthContextValue {
  user: User | null
  loading: boolean
  signUp: (d: { email: string; password: string; fullName: string; country: string; referralCode?: string }) => Promise<{ ok: boolean; error?: string }>
  verifyEmail: (code: string) => Promise<{ ok: boolean; error?: string }>
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string; needs2fa?: boolean }>
  confirm2fa: (code: string) => Promise<{ ok: boolean; error?: string }>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  updateUser: (patch: { fullName?: string; country?: string }) => Promise<{ ok: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingToken, setPendingToken] = useState<string | null>(null)

  // The ONLY source of truth for "who is logged in": ask the backend. The
  // httpOnly session cookie (set by /auth/login, /auth/register, or
  // /auth/2fa/login-verify) is what actually authenticates this call — the
  // frontend never reads or stores a raw session token.
  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ user: User }>('/auth/me')
      setUser(res.user)
    } catch {
      // Not logged in / session expired / backend unreachable — never fall
      // back to a cached user. No session means no user, full stop.
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const signUp: AuthContextValue['signUp'] = useCallback(async ({ email, password, fullName, country }) => {
    try {
      // referralCode is intentionally NOT sent — the backend has no such
      // field (RegisterDto rejects unknown fields) and referrals remain a
      // cosmetic, non-financial frontend concept in this phase.
      await api.post('/auth/register', { email, password, fullName, country })
      await refresh()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.message : 'Sign up failed.' }
    }
  }, [refresh])

  const verifyEmail: AuthContextValue['verifyEmail'] = useCallback(async (code) => {
    // No backend concept of email verification exists yet, and nothing in
    // this app actually gates access on it — this is a cosmetic, local-only
    // step so the page doesn't need to be removed outright.
    if (code.trim().length !== 6) return { ok: false, error: 'Enter the 6-digit code we sent to your email.' }
    return { ok: true }
  }, [])

  const signIn: AuthContextValue['signIn'] = useCallback(async (email, password) => {
    try {
      const res = await api.post<{ user: User } | { needsTwoFactor: true; pendingToken: string }>('/auth/login', { email, password })
      if ('needsTwoFactor' in res) {
        setPendingToken(res.pendingToken)
        return { ok: false, needs2fa: true }
      }
      await refresh()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.message : 'Sign in failed.' }
    }
  }, [refresh])

  const confirm2fa: AuthContextValue['confirm2fa'] = useCallback(async (code) => {
    if (!pendingToken) return { ok: false, error: 'No pending 2FA challenge.' }
    try {
      await api.post('/auth/2fa/login-verify', { pendingToken, code })
      setPendingToken(null)
      await refresh()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.message : 'Verification failed.' }
    }
  }, [pendingToken, refresh])

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout') } catch { /* cookie may already be invalid — proceed to clear local state regardless */ }
    setPendingToken(null)
    setUser(null)
  }, [])

  const updateUser: AuthContextValue['updateUser'] = useCallback(async (patch) => {
    try {
      const res = await api.patch<User>('/users/me', patch)
      setUser(res)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.message : 'Update failed.' }
    }
  }, [])

  const value: AuthContextValue = {
    user, loading,
    signUp, verifyEmail, signIn, confirm2fa, signOut, refresh, updateUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
