// Shared Admin design-system primitives (TRUST Admin final UI polish pass).
// Dark navy exchange-admin visual language matching the reference
// screenshots — see the `admin` color namespace in tailwind.config.js and
// the `.admin-*` component classes in src/index.css. Gold = primary accent/
// action, green = success, red = danger, blue = informational/secondary
// action. Deliberately a separate token set from the site-wide ink/gold
// classes so this cannot shift the customer-facing pages' look.
import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, RefreshCw, type LucideIcon } from 'lucide-react'
import { EmptyState } from '../EmptyState'
import type { panelMessage } from './useAdminApi'

export function AdminPageHeader({
  icon: Icon, title, description, actions, back,
}: {
  icon: LucideIcon
  title: string
  description?: string
  actions?: ReactNode
  back?: { to: string; label?: string }
}) {
  return (
    <div className="mb-6">
      {back && <AdminBackLink to={back.to} label={back.label} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-admin-gold/15 text-admin-gold"><Icon className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-bold text-admin-text">{title}</h1>
            {description && <p className="text-sm text-admin-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function AdminBackLink({ to, label = 'Back to Dashboard' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="admin-btn-secondary mb-4 inline-flex">
      <ArrowLeft className="h-3.5 w-3.5" /> {label}
    </Link>
  )
}

export function AdminCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`admin-card p-5 ${className}`}>{children}</div>
}

export function AdminSection({ title, description, children, className = '' }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`admin-card p-5 ${className}`}>
      {title && <h3 className="font-bold text-admin-text">{title}</h3>}
      {description && <p className="mt-1 text-sm text-admin-muted">{description}</p>}
      <div className={title || description ? 'mt-4' : ''}>{children}</div>
    </div>
  )
}

type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral'

// Status → badge appearance (spec section 9): ACTIVE/CONFIRMED/APPROVED/
// VERIFIED/ENABLED/LIVE = green, FAILED/REJECTED/DISABLED/LOSS = red,
// PENDING/MAINTENANCE = amber, everything else a neutral outline.
const TONE_CLASS: Record<BadgeTone, string> = {
  success: 'border-bull/30 bg-bull/10 text-bull',
  danger: 'border-bear/30 bg-bear/10 text-bear',
  warning: 'border-admin-gold/30 bg-admin-gold/10 text-admin-gold',
  info: 'border-ocean-500/30 bg-ocean-500/10 text-ocean-400',
  neutral: 'border-admin-border text-admin-muted',
}

export function AdminStatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`admin-badge ${TONE_CLASS[tone]}`}>{children}</span>
}

// Best-effort common status → tone mapping shared across Users/Deposits/
// Withdrawals/KYC/CMS/Support tables — callers can still pass an explicit
// tone to AdminStatusBadge when a status needs special-casing.
export function statusTone(status: string): BadgeTone {
  const s = status.toUpperCase()
  if (['ACTIVE', 'VERIFIED', 'PUBLISHED', 'CONFIRMED', 'APPROVED', 'ENABLED', 'RESOLVED', 'ON', 'LIVE', 'WIN'].includes(s)) return 'success'
  if (['SUSPENDED', 'REJECTED', 'EXPIRED', 'FAILED', 'DISABLED', 'CLOSED', 'OFF', 'LOSS'].includes(s)) return 'danger'
  if (['PENDING', 'PROCESSING', 'REVIEW', 'WAITING_FOR_CUSTOMER', 'WAITING_INTERNAL', 'DRAFT', 'MAINTENANCE'].includes(s)) return 'warning'
  if (['IN_PROGRESS', 'RESTRICTED', 'ARCHIVED'].includes(s)) return 'info'
  return 'neutral'
}

export function AdminSearchInput({ value, onChange, placeholder, className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-mutedDim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input className="admin-input pl-8" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

export function AdminLoading({ label = 'Loading…' }: { label?: string }) {
  return <div className="admin-card p-10 text-center text-sm text-admin-muted">{label}</div>
}

export function AdminPanel({
  loading, error, refetch, children,
}: {
  loading: boolean
  error: ReturnType<typeof panelMessage> | null
  refetch: () => void
  children: ReactNode
}) {
  if (loading) return <AdminLoading />
  if (error) {
    return (
      <div className="admin-card p-8 text-center">
        <p className="text-sm font-semibold text-bear">{error.kind === 'forbidden' ? 'Forbidden (403)' : error.kind === 'unauthorized' ? 'Unauthorized (401)' : 'Error'}</p>
        <p className="mx-auto mt-2 max-w-md text-xs text-admin-muted">{error.message}</p>
        <button onClick={refetch} className="admin-btn-secondary mt-4"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
      </div>
    )
  }
  return <>{children}</>
}

export { EmptyState as AdminEmptyState }

// Lightweight confirmation dialog for destructive actions that don't
// already require step-up re-authentication (StepUpModal is still the
// right tool for anything fund-safety- or security-critical — this is only
// for the lighter tier, e.g. rejecting a request or deleting a non-financial
// record, where the existing tabs previously fired with no confirmation
// step at all).
export function AdminConfirmDialog({
  title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger', busy, onConfirm, onClose,
}: {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="admin-card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-admin-text">{title}</h3>
        {description && <p className="mt-2 text-sm text-admin-muted">{description}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="admin-btn-secondary">{cancelLabel}</button>
          <button onClick={onConfirm} disabled={busy} className={tone === 'danger' ? 'admin-btn-danger' : 'admin-btn-primary'}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function AdminStat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="admin-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-admin-mutedDim">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-bold text-admin-text">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-admin-mutedDim/70">{hint}</p>}
    </div>
  )
}
