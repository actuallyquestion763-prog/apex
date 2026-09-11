// Admin Contact / Contact Admin — CRUD for the customer-facing support
// contact links (AdminContact backend). Not fund-safety-critical (a support
// link, not a receiving address), so this uses the lighter
// AdminConfirmDialog rather than StepUpModal for delete — matching the
// backend's own guard tier (no step-up on this controller either).
import { useState } from 'react'
import { MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, adminContactIconUrl } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { AdminPageHeader, AdminPanel, AdminCard, AdminStatusBadge, useAdmin, tryAction, AdminEmptyState, AdminConfirmDialog } from '../../components/admin'

interface AdminContactRow { id: string; name: string; url: string; sortOrder: number; enabled: boolean; hasIcon: boolean }

const BLANK_FORM = { name: '', url: '', sortOrder: '0', enabled: true, icon: null as File | null }

function buildForm(fields: Record<string, unknown>, icon?: File | null): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    form.append(key, String(value))
  }
  if (icon) form.append('icon', icon)
  return form
}

export function ContactsPage() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<AdminContactRow[]>('/admin/contacts')
  const [form, setForm] = useState(BLANK_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminContactRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  function startNew() {
    setEditingId(null)
    setForm(BLANK_FORM)
  }

  function startEdit(c: AdminContactRow) {
    setEditingId(c.id)
    setForm({ name: c.name, url: c.url, sortOrder: String(c.sortOrder), enabled: c.enabled, icon: null })
  }

  async function save() {
    if (!form.name.trim() || !form.url.trim()) { push('error', 'Contact name and URL are required.'); return }
    setSaving(true)
    const fields = { name: form.name.trim(), url: form.url.trim(), sortOrder: form.sortOrder.trim() || 0, enabled: form.enabled }
    const res = editingId
      ? await tryAction(() => api.patchForm(`/admin/contacts/${editingId}`, buildForm(fields, form.icon)))
      : await tryAction(() => api.postForm('/admin/contacts', buildForm(fields, form.icon)))
    setSaving(false)
    if (res.ok) { push('success', editingId ? 'Contact updated.' : 'Contact created.'); startNew(); refetch() }
    else push('error', res.error)
  }

  async function toggleEnabled(c: AdminContactRow) {
    const res = await tryAction(() => api.patchForm(`/admin/contacts/${c.id}`, buildForm({ enabled: !c.enabled })))
    if (res.ok) { push('success', `${c.name} ${!c.enabled ? 'enabled' : 'disabled'}.`); refetch() }
    else push('error', res.error)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const res = await tryAction(() => api.del(`/admin/contacts/${deleteTarget.id}`))
    setDeleting(false)
    if (res.ok) { push('success', 'Contact removed.'); setDeleteTarget(null); if (editingId === deleteTarget.id) startNew(); refetch() }
    else push('error', res.error)
  }

  return (
    <div>
      <AdminPageHeader
        icon={MessageCircle}
        title="Admin Contact"
        description="Support contact links shown to customers (e.g. Telegram, WhatsApp, email)."
        back={{ to: '/admin' }}
      />

      <AdminCard>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-admin-text">{editingId ? 'Edit contact' : 'New contact'}</h3>
          <button onClick={startNew} className="admin-btn-info">New</button>
        </div>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="admin-label">Contact Name</label><input className="admin-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Telegram Support" /></div>
            <div><label className="admin-label">Contact URL</label><input className="admin-input" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://t.me/edgetradesupport" /></div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-32"><label className="admin-label">Display Order</label><input className="admin-input" type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} /></div>
            <div className="flex-1 min-w-[200px]">
              <label className="admin-label">Upload Icon (optional)</label>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="text-xs text-admin-muted" onChange={(e) => setForm((f) => ({ ...f, icon: e.target.files?.[0] ?? null }))} />
            </div>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-admin-muted">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
              Enable Contact
            </label>
          </div>
          <button onClick={save} disabled={saving} className="admin-btn-success"><Plus className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}</button>
        </div>
      </AdminCard>

      <div className="mt-6">
        <h3 className="mb-3 font-bold text-admin-text">Contact List</h3>
        <AdminPanel loading={loading} error={error} refetch={refetch}>
          {(data ?? []).length === 0 ? <AdminEmptyState icon={MessageCircle} title="No contact links yet" /> : (
            <div className="space-y-2">
              {(data ?? []).map((c) => (
                <div key={c.id} className="admin-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                  {c.hasIcon ? (
                    <img src={adminContactIconUrl(c.id)} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-admin-border object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-admin-surface text-admin-mutedDim"><MessageCircle className="h-4 w-4" /></div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-admin-text">{c.name}</p>
                    <a href={c.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-ocean-400 hover:underline">{c.url}</a>
                  </div>
                  <span className="text-[11px] text-admin-mutedDim">Order {c.sortOrder}</span>
                  <AdminStatusBadge tone={c.enabled ? 'success' : 'neutral'}>{c.enabled ? 'ENABLED' : 'DISABLED'}</AdminStatusBadge>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button onClick={() => startEdit(c)} className="admin-btn-info px-2.5 py-1.5 text-[11px]"><Pencil className="h-3 w-3" /> Edit</button>
                    <button onClick={() => toggleEnabled(c)} className="admin-btn-secondary px-2.5 py-1.5 text-[11px]">{c.enabled ? 'Disable' : 'Enable'}</button>
                    <button onClick={() => setDeleteTarget(c)} className="admin-btn-danger px-2.5 py-1.5 text-[11px]"><Trash2 className="h-3 w-3" /> Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminPanel>
      </div>

      {deleteTarget && (
        <AdminConfirmDialog
          title={`Delete "${deleteTarget.name}"?`}
          description="This removes the contact link immediately — customers will no longer see it. This cannot be undone."
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
