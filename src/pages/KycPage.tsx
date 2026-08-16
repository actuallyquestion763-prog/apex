import { useRef, useState } from 'react'
import { useAuth } from '../store/auth'
import { submitKyc, pushLocalNotification } from '../store/useStore'
import { useToast } from '../components/Toast'
import { ShieldCheck, Upload, FileCheck2, Clock, CheckCircle2, XCircle, IdCard, AlertCircle } from 'lucide-react'

export function KycPage() {
  const { user, refresh } = useAuth()
  const { push } = useToast()
  const [front, setFront] = useState<string | null>(null)
  const [back, setBack] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const frontRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File | undefined, setter: (v: string) => void) {
    if (!file) return
    if (file.size > 5_000_000) { push('error', 'File too large. Max 5MB.'); return }
    const reader = new FileReader()
    reader.onload = () => setter(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function submit() {
    if (!front || !back) { push('error', 'Upload both the front and back of your ID.'); return }
    setSubmitting(true)
    // Document images are previewed locally only — this platform is not yet
    // connected to a real identity-verification provider, so no document
    // data is uploaded or stored anywhere. Submitting only records that a
    // verification request exists, for admin status tracking.
    const res = await submitKyc()
    setSubmitting(false)
    if (res.ok) {
      push('success', 'Verification request submitted. This is a status-tracking placeholder until a real KYC provider is connected.')
      if (user) pushLocalNotification(user.id, { title: 'KYC submitted', body: 'Your verification request is under review.', kind: 'kyc' })
      await refresh()
    } else {
      push('error', res.error)
    }
  }

  const status = user?.kycStatus ?? 'NOT_STARTED'

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div className={`rounded-2xl border p-6 ${status === 'VERIFIED' ? 'border-bull/30 bg-bull/5' : status === 'PENDING' ? 'border-gold-500/30 bg-gold-500/5' : status === 'REJECTED' ? 'border-bear/30 bg-bear/5' : 'border-ink-600 bg-ink-850'}`}>
        <div className="flex items-center gap-4">
          {status === 'VERIFIED' ? <CheckCircle2 className="h-10 w-10 text-bull" /> : status === 'PENDING' ? <Clock className="h-10 w-10 text-gold-400" /> : status === 'REJECTED' ? <XCircle className="h-10 w-10 text-bear" /> : <ShieldCheck className="h-10 w-10 text-ocean-400" />}
          <div>
            <h3 className="text-lg font-bold text-white">
              {status === 'VERIFIED' ? 'Identity verified' : status === 'PENDING' ? 'Verification in progress' : status === 'REJECTED' ? 'Verification rejected' : 'Verify your identity'}
            </h3>
            <p className="text-sm text-slate-400">
              {status === 'VERIFIED' ? 'Your account is fully verified. You have access to all features.' : status === 'PENDING' ? 'Your request is under review by an admin. This is a status-tracking placeholder — no real identity-verification provider is connected yet.' : status === 'REJECTED' ? 'Your verification request was rejected. You may submit again.' : 'This platform is not yet connected to a real identity-verification provider. Submitting here only records a status-tracking request for admin review.'}
            </p>
          </div>
        </div>
      </div>

      {status !== 'VERIFIED' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <h3 className="flex items-center gap-2 font-bold text-white"><IdCard className="h-5 w-5 text-gold-400" /> ID Front</h3>
            <p className="mt-1 text-sm text-slate-400">Preview only — not uploaded or stored anywhere.</p>
            <input ref={frontRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0], setFront)} />
            <div onClick={() => frontRef.current?.click()} className="mt-4 flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-ink-600 bg-ink-900 p-6 transition hover:border-gold-500/50">
              {front ? (
                <div className="w-full"><img src={front} alt="ID front" className="mx-auto max-h-48 rounded-lg" /><p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-bull"><FileCheck2 className="h-4 w-4" /> Selected — click to replace</p></div>
              ) : (
                <><Upload className="h-8 w-8 text-slate-500" /><p className="text-sm text-slate-500">Click to select front of ID</p><p className="text-xs text-slate-600">JPG, PNG · Max 5MB</p></>
              )}
            </div>
          </div>

          <div className="card p-6">
            <h3 className="flex items-center gap-2 font-bold text-white"><IdCard className="h-5 w-5 text-gold-400" /> ID Back</h3>
            <p className="mt-1 text-sm text-slate-400">Preview only — not uploaded or stored anywhere.</p>
            <input ref={backRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0], setBack)} />
            <div onClick={() => backRef.current?.click()} className="mt-4 flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-ink-600 bg-ink-900 p-6 transition hover:border-gold-500/50">
              {back ? (
                <div className="w-full"><img src={back} alt="ID back" className="mx-auto max-h-48 rounded-lg" /><p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-bull"><FileCheck2 className="h-4 w-4" /> Selected — click to replace</p></div>
              ) : (
                <><Upload className="h-8 w-8 text-slate-500" /><p className="text-sm text-slate-500">Click to select back of ID</p><p className="text-xs text-slate-600">JPG, PNG · Max 5MB</p></>
              )}
            </div>
          </div>
        </div>
      )}

      {status !== 'VERIFIED' && (
        <>
          <div className="flex items-start gap-3 rounded-xl border border-ocean-500/20 bg-ocean-500/5 p-4 text-sm text-slate-400">
            <AlertCircle className="h-5 w-5 shrink-0 text-ocean-400" />
            <p>This platform has no real identity-verification provider connected in this phase. Document images are previewed in your browser only and are never uploaded or stored — submitting only creates a status-tracking request for an admin to approve or reject.</p>
          </div>
          <button onClick={submit} disabled={submitting || status === 'PENDING' || (!front || !back)} className="btn-gold py-3 px-8">
            {submitting ? 'Submitting…' : status === 'PENDING' ? 'Already pending' : 'Submit for verification'}
          </button>
        </>
      )}
    </div>
  )
}
