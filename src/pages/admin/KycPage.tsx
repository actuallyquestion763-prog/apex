// KYC Verification — ported unchanged from the old KycTab/KycReviewPanel.
// Document viewing, approve/reject, and the rejection-reason gate all
// preserved exactly.
import { useState } from 'react'
import { ArrowLeft, ShieldCheck, X, ZoomIn } from 'lucide-react'
import { api } from '../../lib/api'
import { adminKycDocumentUrl } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { AdminPageHeader, AdminPanel, AdminTable, AdminTableHead, AdminStatusBadge, statusTone, useAdmin, tryAction, AdminEmptyState } from '../../components/admin'

interface KycDocumentRow { id: string; kind: 'FRONT' | 'BACK' | 'SELFIE'; mimeType: string; filename: string; size: number; createdAt: string }
interface KycSubmissionRow {
  id: string; userId: string; status: string
  fullName: string | null; dateOfBirth: string | null; country: string | null
  idType: string | null; idNumber: string | null
  submittedAt: string; reviewedAt: string | null; rejectionReason: string | null
  user: { id: string; email: string; fullName: string }
}
interface KycSubmissionDetail extends KycSubmissionRow { documents: KycDocumentRow[] }

export function KycPage() {
  const { data, loading, error, refetch } = useAdmin<KycSubmissionRow[]>('/admin/kyc/submissions')
  const [reviewId, setReviewId] = useState<string | null>(null)

  return (
    <div>
      <AdminPageHeader icon={ShieldCheck} title="KYC Verification" description="Review identity documents and approve or reject submissions." back={{ to: '/admin' }} />
      <div className="space-y-4">
        <AdminPanel loading={loading} error={error} refetch={refetch}>
          {(data ?? []).length === 0 ? <AdminEmptyState icon={ShieldCheck} title="No KYC submissions yet" /> : (
            <AdminTable>
              <AdminTableHead columns={[
                { label: 'ID' }, { label: 'User' }, { label: 'Document' }, { label: 'ID Number' }, { label: 'Country' },
                { label: 'ID Card' }, { label: 'Selfie' }, { label: 'Status' }, { label: 'Date' }, { label: 'Actions', align: 'right' },
              ]} />
              <tbody>
                {(data ?? []).map((k) => (
                  <tr key={k.id} className="border-b border-admin-border/60 hover:bg-admin-surface/50">
                    <td className="px-4 py-2.5 font-mono text-xs text-admin-mutedDim">{k.userId.slice(0, 8)}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-admin-text">{k.user.fullName}</p>
                      <p className="text-xs text-admin-mutedDim">{k.user.email}</p>
                    </td>
                    <td className="px-4 py-2.5 text-admin-muted">{k.idType ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-admin-muted">{k.idNumber ?? '—'}</td>
                    <td className="px-4 py-2.5 text-admin-muted">{k.country ?? '—'}</td>
                    <td className="px-4 py-2.5"><button onClick={() => setReviewId(k.id)} className="admin-btn-info px-2.5 py-1 text-[11px]">View ID</button></td>
                    <td className="px-4 py-2.5"><button onClick={() => setReviewId(k.id)} className="admin-btn-info px-2.5 py-1 text-[11px]">View Selfie</button></td>
                    <td className="px-4 py-2.5"><AdminStatusBadge tone={statusTone(k.status)}>{k.status}</AdminStatusBadge></td>
                    <td className="px-4 py-2.5 text-admin-muted">{new Date(k.submittedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-right"><button onClick={() => setReviewId(k.id)} className="admin-btn-secondary px-2.5 py-1.5 text-[11px]">Review</button></td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          )}
        </AdminPanel>

        {reviewId && <KycReviewPanel id={reviewId} onClose={() => setReviewId(null)} onActed={() => { setReviewId(null); refetch() }} />}
      </div>
    </div>
  )
}

function KycReviewPanel({ id, onClose, onActed }: { id: string; onClose: () => void; onActed: () => void }) {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<KycSubmissionDetail>(`/admin/kyc/submissions/${id}`)
  const [rejectionReason, setRejectionReason] = useState('')
  const [acting, setActing] = useState(false)
  const [zoomDoc, setZoomDoc] = useState<KycDocumentRow | null>(null)

  async function approve() {
    setActing(true)
    const res = await tryAction(() => api.post(`/admin/kyc/${id}/approve`))
    setActing(false)
    if (res.ok) { push('success', 'KYC approved.'); onActed() }
    else push('error', res.error)
  }

  async function reject() {
    if (rejectionReason.trim().length < 3) { push('error', 'Enter a rejection reason (at least 3 characters).'); return }
    setActing(true)
    const res = await tryAction(() => api.post(`/admin/kyc/${id}/reject`, { reason: rejectionReason.trim() }))
    setActing(false)
    if (res.ok) { push('success', 'KYC rejected.'); onActed() }
    else push('error', res.error)
  }

  const DOC_LABELS: Record<string, string> = { FRONT: 'Front of ID', BACK: 'Back of ID', SELFIE: 'Selfie / verification photo' }

  return (
    <div className="admin-card p-6">
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="admin-btn-secondary"><ArrowLeft className="h-3.5 w-3.5" /> Back to list</button>
      </div>

      <AdminPanel loading={loading} error={error} refetch={refetch}>
        {data && (
          <div className="mt-4 space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Customer" value={data.user.fullName} />
              <Field label="UID" value={data.userId} mono />
              <Field label="Status" value={<AdminStatusBadge tone={statusTone(data.status)}>{data.status}</AdminStatusBadge>} />
              <Field label="ID type" value={data.idType ?? '—'} />
              <Field label="ID number" value={data.idNumber ?? '—'} mono />
              <Field label="Date of birth" value={data.dateOfBirth ? new Date(data.dateOfBirth).toLocaleDateString() : '—'} />
              <Field label="Country" value={data.country ?? '—'} />
              <Field label="Submitted" value={new Date(data.submittedAt).toLocaleString()} />
              {data.rejectionReason && <Field label="Last rejection reason" value={data.rejectionReason} />}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-bold text-admin-text">Documents</h4>
              {data.documents.length === 0 ? (
                <p className="text-sm text-admin-mutedDim">No documents on this submission — it predates document upload and cannot be approved until the customer resubmits.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  {data.documents.map((doc) => (
                    <div key={doc.id} className="admin-card overflow-hidden p-3">
                      <p className="mb-2 text-xs font-semibold text-admin-muted">{DOC_LABELS[doc.kind] ?? doc.kind}</p>
                      <button onClick={() => setZoomDoc(doc)} className="group relative block w-full overflow-hidden rounded-lg bg-admin-surface">
                        <img src={adminKycDocumentUrl(doc.id)} alt={DOC_LABELS[doc.kind] ?? doc.kind} className="h-40 w-full object-contain" />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                          <ZoomIn className="h-6 w-6 text-white" />
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="admin-surface p-5">
              <h4 className="mb-3 text-sm font-bold text-admin-text">Admin decision</h4>
              <div className="flex flex-wrap gap-2">
                <button onClick={approve} disabled={acting || data.status === 'VERIFIED'} className="admin-btn-success px-5 py-2">Approve</button>
              </div>
              <div className="mt-4">
                <label className="admin-label">Rejection reason</label>
                <textarea className="admin-input min-h-[80px]" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="e.g. ID image is blurry. Please upload a clear image showing all four corners." />
                <button onClick={reject} disabled={acting || data.status === 'REJECTED'} className="admin-btn-danger mt-2">Reject</button>
              </div>
            </div>
          </div>
        )}
      </AdminPanel>

      {zoomDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setZoomDoc(null)}>
          <div className="relative max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setZoomDoc(null)} aria-label="Close" className="absolute -top-10 right-0 text-slate-300 hover:text-white"><X className="h-6 w-6" /></button>
            <img src={adminKycDocumentUrl(zoomDoc.id)} alt={DOC_LABELS[zoomDoc.kind] ?? zoomDoc.kind} className="max-h-[85vh] w-auto rounded-lg object-contain" />
            <a href={adminKycDocumentUrl(zoomDoc.id)} target="_blank" rel="noreferrer" className="admin-btn-secondary mt-3">Open full size</a>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-admin-mutedDim">{label}</p>
      <p className={`mt-0.5 text-sm text-admin-text ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
