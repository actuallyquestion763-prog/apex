// CMS — pages/announcements/FAQs/media. Not one of the primary dashboard
// cards (see AdminDashboardPage.tsx) but still a real, working section —
// linked from Settings so it isn't hidden. Ported unchanged from the old
// CmsTab and its four sub-tabs.
import { useState } from 'react'
import { FileText, Plus, Upload, Copy, Trash2 } from 'lucide-react'
import type { CmsPage, CmsAnnouncement, CmsFaq, CmsMedia } from '../../types'
import { api, ApiError, mediaUrl } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { AdminPageHeader, AdminPanel, AdminStatusBadge, useAdmin, tryAction, AdminEmptyState } from '../../components/admin'

type CmsSubTab = 'pages' | 'announcements' | 'faqs' | 'media'

export function CmsPage() {
  const [sub, setSub] = useState<CmsSubTab>('pages')
  return (
    <div>
      <AdminPageHeader icon={FileText} title="CMS" description="Site pages, announcements, FAQs, and media." back={{ to: '/admin/settings' }} />
      <div className="space-y-4">
        <div className="flex gap-1.5">
          {(['pages', 'announcements', 'faqs', 'media'] as const).map((s) => (
            <button key={s} onClick={() => setSub(s)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${sub === s ? 'bg-admin-gold/15 text-admin-gold' : 'text-admin-mutedDim hover:bg-admin-surface'}`}>{s}</button>
          ))}
        </div>
        {sub === 'pages' && <CmsPagesTab />}
        {sub === 'announcements' && <CmsAnnouncementsTab />}
        {sub === 'faqs' && <CmsFaqsTab />}
        {sub === 'media' && <CmsMediaTab />}
      </div>
    </div>
  )
}

function CmsPagesTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CmsPage[]>('/admin/cms/pages')
  const [creating, setCreating] = useState(false)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  async function create() {
    const res = await tryAction(() => api.post('/admin/cms/pages', { slug, title, sections: [] }))
    if (res.ok) { push('success', 'Draft page created.'); setSlug(''); setTitle(''); setCreating(false); refetch() }
    else push('error', res.error)
  }

  async function act(id: string, action: 'publish' | 'unpublish' | 'archive') {
    const res = await tryAction(() => api.post(`/admin/cms/pages/${id}/${action}`, { reason: `${action} via admin panel` }))
    if (res.ok) { push('success', `Page ${action}ed.`); refetch() }
    else push('error', res.error)
  }

  return (
    <AdminPanel loading={loading} error={error} refetch={refetch}>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setCreating((c) => !c)} className="admin-btn-secondary"><Plus className="h-3.5 w-3.5" /> New page</button>
      </div>
      {creating && (
        <div className="admin-card mb-3 flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 min-w-[140px]"><label className="admin-label">Slug</label><input className="admin-input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="about" /></div>
          <div className="flex-1 min-w-[140px]"><label className="admin-label">Title</label><input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="About Us" /></div>
          <button onClick={create} className="admin-btn-success">Create draft</button>
        </div>
      )}
      {(data ?? []).length === 0 ? <AdminEmptyState icon={FileText} title="No pages yet" /> : (
        <div className="admin-card overflow-hidden">
          {(data ?? []).map((p) => (
            <div key={p.id} className="border-b border-admin-border/60 last:border-b-0">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-admin-text">{p.title} <span className="text-xs text-admin-mutedDim">/{p.slug}</span></p>
                  <AdminStatusBadge tone={p.status === 'PUBLISHED' ? 'success' : p.status === 'ARCHIVED' ? 'danger' : 'neutral'}>{p.status}</AdminStatusBadge>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setEditingId(editingId === p.id ? null : p.id)} className="admin-btn-info px-2.5 py-1.5 text-[11px]">{editingId === p.id ? 'Close' : 'Edit content'}</button>
                  {p.status !== 'PUBLISHED' && <button onClick={() => act(p.id, 'publish')} className="admin-btn-success px-2.5 py-1.5 text-[11px]">Publish</button>}
                  {p.status === 'PUBLISHED' && <button onClick={() => act(p.id, 'unpublish')} className="admin-btn-secondary px-2.5 py-1.5 text-[11px]">Unpublish</button>}
                  {p.status !== 'ARCHIVED' && <button onClick={() => act(p.id, 'archive')} className="admin-btn-danger px-2.5 py-1.5 text-[11px]">Archive</button>}
                </div>
              </div>
              {editingId === p.id && <CmsPageSectionsEditor page={p} onSaved={() => { setEditingId(null); refetch() }} />}
            </div>
          ))}
        </div>
      )}
    </AdminPanel>
  )
}

// Sections editor kept deliberately simple — a raw-JSON textarea, not a
// visual page builder. Server-side validation (validateSections in
// cms.validation.ts) is still the real safety net — this only saves whatever
// valid JSON the admin submits, and surfaces the backend's rejection message
// verbatim if it's invalid (unsafe link, unknown section type, etc).
function CmsPageSectionsEditor({ page, onSaved }: { page: CmsPage; onSaved: () => void }) {
  const { push } = useToast()
  const [text, setText] = useState(() => JSON.stringify(page.sections, null, 2))
  const [saving, setSaving] = useState(false)

  async function save() {
    let sections: unknown
    try { sections = JSON.parse(text) } catch { push('error', 'Not valid JSON.'); return }
    setSaving(true)
    const res = await tryAction(() => api.patch(`/admin/cms/pages/${page.id}`, { sections, reason: 'Edited content via admin panel' }))
    setSaving(false)
    if (res.ok) { push('success', 'Page content saved.'); onSaved() }
    else push('error', res.error)
  }

  return (
    <div className="border-t border-admin-border bg-admin-bg2 p-4">
      <p className="mb-2 text-xs text-admin-mutedDim">Sections JSON — array of {'{ type, fields }'} blocks. Allowed types: hero, feature, stats, cta, text, trust, faq_teaser, footer.</p>
      <textarea className="admin-input min-h-[220px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <button onClick={save} disabled={saving} className="admin-btn-success mt-2">{saving ? 'Saving…' : 'Save content'}</button>
    </div>
  )
}

function CmsAnnouncementsTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CmsAnnouncement[]>('/admin/cms/announcements')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  async function create() {
    const res = await tryAction(() => api.post('/admin/cms/announcements', { title, body }))
    if (res.ok) { push('success', 'Announcement created.'); setTitle(''); setBody(''); setCreating(false); refetch() }
    else push('error', res.error)
  }

  async function act(id: string, action: 'publish' | 'unpublish' | 'archive') {
    const res = await tryAction(() => api.post(`/admin/cms/announcements/${id}/${action}`, { reason: `${action} via admin panel` }))
    if (res.ok) { push('success', `Announcement ${action}ed.`); refetch() }
    else push('error', res.error)
  }

  return (
    <AdminPanel loading={loading} error={error} refetch={refetch}>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setCreating((c) => !c)} className="admin-btn-secondary"><Plus className="h-3.5 w-3.5" /> New announcement</button>
      </div>
      {creating && (
        <div className="admin-card mb-3 space-y-2 p-4">
          <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <textarea className="admin-input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" rows={2} />
          <button onClick={create} className="admin-btn-success">Create draft</button>
        </div>
      )}
      {(data ?? []).length === 0 ? <AdminEmptyState icon={FileText} title="No announcements yet" /> : (
        <div className="admin-card overflow-hidden">
          {(data ?? []).map((a) => (
            <div key={a.id} className="flex items-center justify-between border-b border-admin-border/60 px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm font-semibold text-admin-text">{a.title}</p>
                <p className="text-xs text-admin-mutedDim">{a.priority} · {a.loggedInOnly ? 'Logged-in only' : 'Public'} · <span className={a.status === 'PUBLISHED' ? 'text-bull' : ''}>{a.status}</span></p>
              </div>
              <div className="flex gap-1.5">
                {a.status !== 'PUBLISHED' && <button onClick={() => act(a.id, 'publish')} className="admin-btn-success px-2.5 py-1.5 text-[11px]">Publish</button>}
                {a.status === 'PUBLISHED' && <button onClick={() => act(a.id, 'unpublish')} className="admin-btn-secondary px-2.5 py-1.5 text-[11px]">Unpublish</button>}
                {a.status !== 'ARCHIVED' && <button onClick={() => act(a.id, 'archive')} className="admin-btn-danger px-2.5 py-1.5 text-[11px]">Archive</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminPanel>
  )
}

function CmsFaqsTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CmsFaq[]>('/admin/cms/faqs')
  const [creating, setCreating] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  async function create() {
    const res = await tryAction(() => api.post('/admin/cms/faqs', { question, answer }))
    if (res.ok) { push('success', 'FAQ created.'); setQuestion(''); setAnswer(''); setCreating(false); refetch() }
    else push('error', res.error)
  }

  async function act(id: string, action: 'publish' | 'archive') {
    const res = await tryAction(() => api.post(`/admin/cms/faqs/${id}/${action}`, { reason: `${action} via admin panel` }))
    if (res.ok) { push('success', `FAQ ${action}d.`); refetch() }
    else push('error', res.error)
  }

  return (
    <AdminPanel loading={loading} error={error} refetch={refetch}>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setCreating((c) => !c)} className="admin-btn-secondary"><Plus className="h-3.5 w-3.5" /> New FAQ</button>
      </div>
      {creating && (
        <div className="admin-card mb-3 space-y-2 p-4">
          <input className="admin-input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question" />
          <textarea className="admin-input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer" rows={2} />
          <button onClick={create} className="admin-btn-success">Create draft</button>
        </div>
      )}
      {(data ?? []).length === 0 ? <AdminEmptyState icon={FileText} title="No FAQs yet" /> : (
        <div className="admin-card overflow-hidden">
          {(data ?? []).map((f) => (
            <div key={f.id} className="flex items-center justify-between border-b border-admin-border/60 px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm font-semibold text-admin-text">{f.question}</p>
                <AdminStatusBadge tone={f.status === 'PUBLISHED' ? 'success' : 'neutral'}>{f.status}</AdminStatusBadge>
              </div>
              <div className="flex gap-1.5">
                {f.status !== 'PUBLISHED' && <button onClick={() => act(f.id, 'publish')} className="admin-btn-success px-2.5 py-1.5 text-[11px]">Publish</button>}
                {f.status !== 'ARCHIVED' && <button onClick={() => act(f.id, 'archive')} className="admin-btn-danger px-2.5 py-1.5 text-[11px]">Archive</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminPanel>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const MEDIA_KINDS = ['IMAGE', 'DOCUMENT', 'LOGO', 'BANNER'] as const

function CmsMediaTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CmsMedia[]>('/admin/cms/media')
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<(typeof MEDIA_KINDS)[number]>('IMAGE')
  const [uploading, setUploading] = useState(false)

  async function upload() {
    if (!file) { push('error', 'Choose a file first.'); return }
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    setUploading(true)
    try {
      await api.postForm('/admin/cms/media', form)
      push('success', 'Media uploaded.')
      setFile(null)
      refetch()
    } catch (e) {
      push('error', e instanceof ApiError ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function remove(id: string) {
    const res = await tryAction(() => api.del(`/admin/cms/media/${id}`))
    if (res.ok) { push('success', 'Media deleted.'); refetch() }
    else push('error', res.error) // e.g. "referenced by published page X" — surfaced verbatim, deletion correctly blocked
  }

  function copyReference(id: string) {
    const url = mediaUrl(id)
    navigator.clipboard?.writeText(url).then(
      () => push('success', 'Reference copied — paste it into a section\'s image/link field.'),
      () => push('error', 'Could not copy to clipboard.'),
    )
  }

  return (
    <AdminPanel loading={loading} error={error} refetch={refetch}>
      <div className="admin-card mb-3 flex flex-wrap items-end gap-2 p-4">
        <div className="flex-1 min-w-[200px]">
          <label className="admin-label">File (PNG, JPEG, WEBP, GIF, or PDF — max 5MB)</label>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="admin-input" />
        </div>
        <div>
          <label className="admin-label">Kind</label>
          <select className="admin-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {MEDIA_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <button onClick={upload} disabled={uploading} className="admin-btn-primary"><Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload'}</button>
      </div>

      {(data ?? []).length === 0 ? <AdminEmptyState icon={Upload} title="No media uploaded yet" /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((m) => (
            <div key={m.id} className="admin-card overflow-hidden p-3">
              {m.mimeType.startsWith('image/') ? (
                <img src={mediaUrl(m.id)} alt={m.filename} className="mb-2 h-32 w-full rounded-lg object-cover" />
              ) : (
                <div className="mb-2 flex h-32 w-full items-center justify-center rounded-lg bg-admin-surface text-admin-mutedDim"><FileText className="h-8 w-8" /></div>
              )}
              <p className="truncate text-sm font-medium text-admin-text" title={m.filename}>{m.filename}</p>
              <p className="text-xs text-admin-mutedDim">{m.kind} · {formatBytes(m.size)} · {new Date(m.createdAt).toLocaleDateString()}</p>
              <div className="mt-2 flex gap-1.5">
                <button onClick={() => copyReference(m.id)} className="admin-btn-secondary flex-1 text-[11px]"><Copy className="h-3.5 w-3.5" /> Copy reference</button>
                <button onClick={() => remove(m.id)} className="admin-btn-danger px-2.5"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminPanel>
  )
}
