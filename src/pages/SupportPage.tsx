import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, attachmentUrl } from '../lib/api'
import { useToast } from '../components/Toast'
import PageHeader from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import type { SupportTicket, SupportCategory } from '../types'
import { Headset, Plus, Send, ArrowLeft, Paperclip } from 'lucide-react'

// Customer-facing support: list own tickets, open one, create one, reply.
// Everything here talks only to /support/* (never /admin/support/*) — the
// backend enforces ownership on every one of these calls regardless of what
// the frontend does or doesn't show (see backend/src/support/support.service.ts).
export function SupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null)
  const [categories, setCategories] = useState<SupportCategory[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refetch = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [t, c] = await Promise.all([api.get<SupportTicket[]>('/support/tickets'), api.get<SupportCategory[]>('/support/categories')])
      setTickets(t)
      setCategories(c)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load support tickets.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refetch() }, [refetch])

  const selected = tickets?.find((t) => t.id === selectedId)

  if (selectedId && selected) {
    return <TicketDetail ticket={selected} onBack={() => setSelectedId(null)} onChanged={refetch} />
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Support" subtitle="Get help with your account, deposits, withdrawals, or trading." />

      {!creating ? (
        <button onClick={() => setCreating(true)} className="btn-gold"><Plus className="h-4 w-4" /> New support ticket</button>
      ) : (
        <NewTicketForm categories={categories} onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); refetch(); setSelectedId(id) }} />
      )}

      {loading ? (
        <div className="card p-10 text-center text-sm text-slate-500">Loading…</div>
      ) : error ? (
        <div className="card p-8 text-center"><p className="text-sm text-bear">{error}</p></div>
      ) : (tickets ?? []).length === 0 ? (
        <EmptyState icon={Headset} title="No support tickets yet" hint="Open one above if you need help." />
      ) : (
        <div className="card overflow-hidden">
          {(tickets ?? []).map((t) => (
            <button key={t.id} onClick={() => setSelectedId(t.id)} className="flex w-full items-center justify-between border-b border-ink-700/40 px-5 py-3.5 text-left last:border-b-0 hover:bg-ink-800/40">
              <div>
                <p className="text-sm font-semibold text-white">{t.subject}</p>
                <p className="text-xs text-slate-500">{t.category?.name} · {t.priority} priority · {new Date(t.createdAt).toLocaleDateString()}</p>
              </div>
              <span className={`chip ${t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'border-bull/30 text-bull' : 'border-ocean-500/30 text-ocean-300'}`}>{t.status.replace(/_/g, ' ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NewTicketForm({ categories, onCancel, onCreated }: { categories: SupportCategory[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const { push } = useToast()
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!categoryId || !subject.trim() || !message.trim()) { push('error', 'Fill in all fields.'); return }
    setSubmitting(true)
    try {
      const ticket = await api.post<SupportTicket>('/support/tickets', { categoryId, subject, message, requestedPriority: priority })
      push('success', 'Support ticket created.')
      onCreated(ticket.id)
    } catch (e) {
      push('error', e instanceof ApiError ? e.message : 'Could not create ticket.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card space-y-3 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Category</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Priority</label>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div><label className="label">Subject</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary" /></div>
      <div><label className="label">Message</label><textarea className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe your issue…" /></div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={submitting} className="btn-gold">{submitting ? 'Submitting…' : 'Submit ticket'}</button>
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
      </div>
    </div>
  )
}

function TicketDetail({ ticket, onBack, onChanged }: { ticket: SupportTicket; onBack: () => void; onChanged: () => void }) {
  const { push } = useToast()
  const [detail, setDetail] = useState<SupportTicket>(ticket)
  const [reply, setReply] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)

  const refetch = useCallback(async () => {
    try { setDetail(await api.get<SupportTicket>(`/support/tickets/${ticket.id}`)) } catch { /* keep showing last known state */ }
  }, [ticket.id])

  useEffect(() => { refetch() }, [refetch])

  async function send() {
    if (!reply.trim() && !file) return
    setSending(true)
    try {
      if (file) {
        const form = new FormData()
        form.append('file', file)
        if (reply.trim()) form.append('body', reply)
        await api.postForm(`/support/tickets/${ticket.id}/attachments`, form)
      } else {
        await api.post(`/support/tickets/${ticket.id}/messages`, { body: reply })
      }
      setReply('')
      setFile(null)
      await refetch()
      onChanged()
    } catch (e) {
      push('error', e instanceof ApiError ? e.message : 'Could not send reply.')
    } finally {
      setSending(false)
    }
  }

  const canReply = detail.status !== 'CLOSED'

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost text-xs"><ArrowLeft className="h-3.5 w-3.5" /> Back to tickets</button>
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{detail.subject}</h2>
          <span className="chip">{detail.status.replace(/_/g, ' ')}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">{detail.category?.name} · {detail.priority} priority (you requested {detail.requestedPriority}) · Opened {new Date(detail.createdAt).toLocaleString()}</p>
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
          {(detail.messages ?? []).map((m) => (
            <div key={m.id} className={`flex ${m.authorId === detail.userId ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${m.authorId === detail.userId ? 'bg-ocean-600 text-white' : 'bg-ink-800 text-slate-200'}`}>
                <p className="mb-0.5 text-[11px] font-semibold opacity-70">{m.author?.fullName ?? (m.authorId === detail.userId ? 'You' : 'Support')}</p>
                {m.body}
                {(m.attachments ?? []).map((a) => (
                  <a key={a.id} href={attachmentUrl(a.id)} download className="mt-1.5 flex items-center gap-1.5 text-xs underline opacity-90 hover:opacity-100">
                    <Paperclip className="h-3 w-3" /> {a.filename}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        {canReply ? (
          <div className="space-y-2 border-t border-ink-700 bg-ink-800 p-3">
            <div className="flex items-center gap-2">
              <input className="input flex-1" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Type a reply…" />
              <button onClick={send} disabled={sending} className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-500 text-ink-950 hover:bg-gold-400 disabled:opacity-50"><Send className="h-4 w-4" /></button>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <Paperclip className="h-3.5 w-3.5" />
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
            </label>
          </div>
        ) : (
          <p className="border-t border-ink-700 bg-ink-800 p-3 text-center text-xs text-slate-500">This ticket is closed. Open a new ticket if you need further help.</p>
        )}
      </div>
    </div>
  )
}
