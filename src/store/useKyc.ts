import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { api, ApiError } from '../lib/api'
import type { KycIdType, KycVerificationSummary } from '../types'

// Real submission + private document storage — the backend is the only
// source of truth for status/history here; nothing is cached beyond what
// it just returned (same pattern as useCryptoDeposits.ts).
export function useKycMine() {
  const { user } = useAuth()
  const [data, setData] = useState<KycVerificationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!user) { setData(null); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<KycVerificationSummary | Record<string, never>>('/kyc/me')
      // The backend sends an empty body (not JSON null) when there is no
      // verification yet — see kyc.e2e-spec.ts's note on this.
      setData(res && 'id' in res ? (res as KycVerificationSummary) : null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { refetch() }, [refetch])
  return { verification: data, loading, error, refetch }
}

export interface SubmitKycParams {
  fullName: string
  dateOfBirth: string
  country: string
  idType: KycIdType
  idNumber: string
  front: File
  back: File | null
  selfie: File
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export async function submitKyc(params: SubmitKycParams): Promise<ActionResult<KycVerificationSummary>> {
  try {
    const form = new FormData()
    form.append('fullName', params.fullName)
    form.append('dateOfBirth', params.dateOfBirth)
    form.append('country', params.country)
    form.append('idType', params.idType)
    form.append('idNumber', params.idNumber)
    form.append('front', params.front)
    if (params.back) form.append('back', params.back)
    form.append('selfie', params.selfie)
    return { ok: true, data: await api.postForm<KycVerificationSummary>('/kyc/submit', form) }
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Submission failed.' }
  }
}
