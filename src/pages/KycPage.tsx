import { useState } from 'react'
import { useAuth } from '../store/auth'
import { useKycMine, submitKyc } from '../store/useKyc'
import { KycDocumentUpload } from '../components/kyc/KycDocumentUpload'
import { useToast } from '../components/Toast'
import type { KycIdType } from '../types'
import { ShieldCheck, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

const ID_TYPES: { value: KycIdType; label: string; needsBack: boolean }[] = [
  { value: 'NATIONAL_ID', label: 'National ID card', needsBack: true },
  { value: 'PASSPORT', label: 'Passport', needsBack: false },
  { value: 'DRIVERS_LICENSE', label: "Driver's license", needsBack: true },
]

export function KycPage() {
  const { user, refresh } = useAuth()
  const { verification, loading: statusLoading, refetch } = useKycMine()
  const { push } = useToast()

  const [fullName, setFullName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [country, setCountry] = useState('')
  const [idType, setIdType] = useState<KycIdType>('NATIONAL_ID')
  const [idNumber, setIdNumber] = useState('')
  const [front, setFront] = useState<File | null>(null)
  const [back, setBack] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const status = user?.kycStatus ?? 'NOT_STARTED'
  const selectedIdType = ID_TYPES.find((t) => t.value === idType)!
  const canSubmit = status === 'NOT_STARTED' || status === 'REJECTED' || status === 'EXPIRED'

  async function submit() {
    if (!fullName.trim() || !dateOfBirth || !country.trim() || !idNumber.trim()) {
      push('error', 'Fill in all identity fields.')
      return
    }
    if (!front) { push('error', 'Upload the front of your ID.'); return }
    if (selectedIdType.needsBack && !back) { push('error', 'Upload the back of your ID.'); return }

    setSubmitting(true)
    const res = await submitKyc({ fullName: fullName.trim(), dateOfBirth, country: country.trim(), idType, idNumber: idNumber.trim(), front, back: selectedIdType.needsBack ? back : null })
    setSubmitting(false)
    if (res.ok) {
      push('success', 'Verification submitted. Our team will review it shortly.')
      setFront(null); setBack(null)
      await Promise.all([refresh(), refetch()])
    } else {
      push('error', res.error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div className={`rounded-2xl border p-6 ${status === 'VERIFIED' ? 'border-bull/30 bg-bull/5' : status === 'PENDING' ? 'border-gold-500/30 bg-gold-500/5' : status === 'REJECTED' || status === 'EXPIRED' ? 'border-bear/30 bg-bear/5' : 'border-ink-600 bg-ink-850'}`}>
        <div className="flex items-center gap-4">
          {status === 'VERIFIED' ? <CheckCircle2 className="h-10 w-10 text-bull" /> : status === 'PENDING' ? <Clock className="h-10 w-10 text-gold-400" /> : status === 'REJECTED' || status === 'EXPIRED' ? <XCircle className="h-10 w-10 text-bear" /> : <ShieldCheck className="h-10 w-10 text-ocean-400" />}
          <div>
            <h3 className="text-lg font-bold text-white">
              {status === 'VERIFIED' ? 'Identity verified' : status === 'PENDING' ? 'Verification in progress' : status === 'REJECTED' ? 'Verification rejected' : status === 'EXPIRED' ? 'Verification expired' : 'Verify your identity'}
            </h3>
            <p className="text-sm text-slate-400">
              {status === 'VERIFIED' ? 'Your account is fully verified.' : status === 'PENDING' ? 'Your submission is under review by our team.' : status === 'REJECTED' ? 'Your verification request was rejected — see the reason below. You may submit again.' : status === 'EXPIRED' ? 'Your verification has expired. Please submit again.' : 'Submit your identity document to unlock full account features.'}
            </p>
          </div>
        </div>
        {!statusLoading && verification?.rejectionReason && (status === 'REJECTED' || status === 'EXPIRED') && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-bear/20 bg-bear/5 p-4 text-sm text-slate-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-bear" />
            <div>
              <p className="font-medium text-bear">Rejection reason</p>
              <p className="mt-0.5 text-slate-400">{verification.rejectionReason}</p>
            </div>
          </div>
        )}
      </div>

      {canSubmit && (
        <>
          <div className="card grid gap-4 p-6 sm:grid-cols-2">
            <div className="sm:col-span-2"><h3 className="font-bold text-white">Identity information</h3></div>
            <div>
              <label className="label">Full legal name</label>
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="As shown on your ID" />
            </div>
            <div>
              <label className="label" htmlFor="kyc-dob">Date of birth</label>
              <input id="kyc-dob" className="input" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </div>
            <div>
              <label className="label">Country</label>
              <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country of residence" />
            </div>
            <div>
              <label className="label" htmlFor="kyc-id-type">ID type</label>
              <select id="kyc-id-type" className="input" value={idType} onChange={(e) => { setIdType(e.target.value as KycIdType); setBack(null) }}>
                {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">ID number</label>
              <input className="input font-mono" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Document number" />
            </div>
          </div>

          <div className={`grid gap-6 ${selectedIdType.needsBack ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
            <div className="card p-6"><KycDocumentUpload label={selectedIdType.needsBack ? 'Front of ID' : 'ID document'} file={front} onSelect={setFront} /></div>
            {selectedIdType.needsBack && (
              <div className="card p-6"><KycDocumentUpload label="Back of ID" file={back} onSelect={setBack} /></div>
            )}
          </div>

          <button onClick={submit} disabled={submitting} className="btn-gold py-3 px-8">
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </button>
        </>
      )}
    </div>
  )
}
