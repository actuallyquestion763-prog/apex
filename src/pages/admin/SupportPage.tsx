// Customer Support — a proper two-panel chat interface (left: searchable
// conversation list, right: selected ticket's message thread). All
// underlying behavior is unchanged from the previous ticket-list version:
// same /admin/support/tickets(+/:id) endpoints, same filters (client-side,
// same reasoning as before — simpler than a filter-param API at this
// platform's scale), same reply/attach/status/assign actions.
import { useEffect, useState } from 'react'
import { ArrowLeft, Headset, Paperclip, Search, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { SupportTicket } from '../../types'
import { api, attachmentUrl } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { AdminPageHeader, AdminPanel, AdminStatusBadge, statusTone, useAdmin, tryAction, AdminEmptyState } from '../../components/admin'

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED'] as const
const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

export function SupportPage() {
  const { error, loading, data, refetch } = useAdmin<SupportTicket[]>('/admin/support/tickets')
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [category, setCategory] = useState('')
  const [agent, setAgent] = useState('')
  const [q, setQ] = useState('')

  const categories = Array.from(new Set((data ?? []).map((t) => t.category?.name).filter(Boolean))) as string[]
  const agents = Array.from(new Map((data ?? []).filter((t) => t.assignedAgent).map((t) => [t.assignedAgent!.id, t.assignedAgent!])).values())

  const filtered = (data ?? []).filter((t) => {
    if (status && t.status !== status) return false
    if (priority && t.priority !== priority) return false
    if (category && t.category?.name !== category) return false
    if (agent === '__unassigned__' && t.assignedAgentId) return false
    if (agent && agent !== '__unassigned__' && t.assignedAgentId !== agent) return false
    if (q && !`${t.subject} ${t.user?.email ?? ''} ${t.user?.fullName ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })
  const selectedTicket = filtered.find((t) => t.id === selected) ?? (data ?? []).find((t) => t.id === selected)

  return (
    <div>
      <AdminPageHeader icon={Headset} title="Customer Support" description="Support tickets and live conversation threads." back={{ to: '/admin' }} />
      <AdminPanel loading={loading} error={error} refetch={refetch}>
        <div className="admin-card flex overflow-hidden" style={{ height: 'min(680px, calc(100vh - 220px))' }}>
          {/* Left sidebar — search + conversation list */}
          <div className={`w-full shrink-0 flex-col border-r border-admin-border md:flex md:w-80 ${selected ? 'hidden md:flex' : 'flex'}`}>
            <div className="border-b border-admin-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold text-admin-text">Customer Support</p>
                <Link to="/admin" className="admin-btn-secondary px-2 py-1 text-[11px]"><ArrowLeft className="h-3 w-3" /> Back</Link>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-mutedDim" />
                <input className="admin-input pl-8 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer or subject" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <select className="admin-input py-1.5 text-[11px]" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="admin-input py-1.5 text-[11px]" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="">All priorities</option>
                  {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select className="admin-input py-1.5 text-[11px]" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="admin-input py-1.5 text-[11px]" value={agent} onChange={(e) => setAgent(e.target.value)}>
                  <option value="">All agents</option>
                  <option value="__unassigned__">Unassigned</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
                </select>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <AdminEmptyState icon={Headset} title="No conversations match" />
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelected(t.id)}
                    className={`flex w-full items-start gap-2.5 border-b border-admin-border/60 px-3 py-3 text-left transition ${selected === t.id ? 'bg-ocean-500/15' : 'hover:bg-admin-surface'}`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-admin-gold/15 text-xs font-bold text-admin-gold">
                      {(t.user?.fullName ?? t.user?.email ?? '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-sm font-semibold text-admin-text">{t.user?.fullName ?? t.user?.email ?? 'Unknown customer'}</p>
                        <span className="shrink-0 text-[10px] text-admin-mutedDim">{new Date(t.updatedAt).toLocaleDateString()}</span>
                      </div>
                      <p className="truncate text-[11px] text-admin-mutedDim">ID: {t.userId.slice(0, 8)}</p>
                      <p className="mt-0.5 truncate text-xs text-admin-muted">{t.subject}</p>
                      <div className="mt-1"><AdminStatusBadge tone={statusTone(t.status)}>{t.status}</AdminStatusBadge></div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Main chat panel */}
          <div className={`flex-1 flex-col md:flex ${selected ? 'flex' : 'hidden md:flex'}`}>
            {selectedTicket ? (
              <SupportTicketDetail ticket={selectedTicket} onBack={() => setSelected(null)} onChanged={refetch} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-admin-mutedDim">Select a conversation to view messages</div>
            )}
          </div>
        </div>
      </AdminPanel>
    </div>
  )
}

function SupportTicketDetail({ ticket, onBack, onChanged }: { ticket: SupportTicket; onBack: () => void; onChanged: () => void }) {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<SupportTicket>(`/admin/support/tickets/${ticket.id}`)
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [agents, setAgents] = useState<{ id: string; fullName: string; email: string }[] | null>(null)

  useEffect(() => {
    // Not every viewer has support.tickets.assign — a 403 here just means
    // "don't show the assign control", not a page-level error.
    api.get<{ id: string; fullName: string; email: string }[]>('/admin/support/agents').then(setAgents).catch(() => setAgents(null))
  }, [])

  async function sendReply() {
    if (!reply.trim() && !file) return
    setSending(true)
    let res: { ok: true; data: unknown } | { ok: false; error: string }
    if (file) {
      const form = new FormData()
      form.append('file', file)
      if (reply.trim()) form.append('body', reply)
      form.append('visibility', internal ? 'INTERNAL' : 'PUBLIC')
      res = await tryAction(() => api.postForm(`/admin/support/tickets/${ticket.id}/attachments`, form))
    } else {
      res = await tryAction(() => api.post(`/admin/support/tickets/${ticket.id}/messages`, { body: reply, visibility: internal ? 'INTERNAL' : 'PUBLIC' }))
    }
    setSending(false)
    if (res.ok) { setReply(''); setFile(null); refetch(); onChanged() }
    else push('error', res.error)
  }

  async function setStatus(status: string) {
    const res = await tryAction(() => api.patch(`/admin/support/tickets/${ticket.id}/status`, { status, reason: `Set to ${status} via admin panel` }))
    if (res.ok) { push('success', `Status set to ${status}.`); refetch(); onChanged() }
    else push('error', res.error)
  }

  async function assign(agentId: string) {
    if (!agentId) return
    const res = await tryAction(() => api.post(`/admin/support/tickets/${ticket.id}/assign`, { agentId, reason: 'Assigned via admin panel' }))
    if (res.ok) { push('success', 'Ticket assigned.'); refetch(); onChanged() }
    else push('error', res.error)
  }

  const customerName = ticket.user?.fullName ?? ticket.user?.email ?? 'Unknown customer'

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-admin-border px-4 py-3">
        <button onClick={onBack} className="admin-btn-secondary px-2 py-1.5 text-[11px] md:hidden">←</button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-admin-gold/15 text-sm font-bold text-admin-gold">
          {customerName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-admin-text">{customerName}</p>
          <p className="truncate text-[11px] text-admin-mutedDim">ID: {ticket.userId} · {ticket.subject}</p>
        </div>
        {data && <AdminStatusBadge tone={statusTone(data.status)}>{data.status}</AdminStatusBadge>}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-admin-mutedDim">Loading…</div>
      ) : error || !data ? (
        <div className="flex flex-1 items-center justify-center text-xs text-bear">{error?.message ?? 'Could not load ticket.'}</div>
      ) : (
        <>
          {/* Status / assign controls */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-admin-border px-4 py-2">
            {(['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)} className="admin-btn-secondary px-2 py-1 text-[10px]">{s}</button>
            ))}
            {agents && (
              <select className="admin-input ml-auto w-auto py-1 text-[11px]" value={data.assignedAgentId ?? ''} onChange={(e) => assign(e.target.value)}>
                <option value="">Unassigned — assign to…</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
              </select>
            )}
          </div>

          {/* Message thread */}
          <div className="flex-1 space-y-3 overflow-y-auto bg-admin-bg2 px-4 py-4">
            {(data.messages ?? []).map((m) => {
              const isCustomer = m.author?.role === 'USER' || (!m.author?.role && m.authorId === data.userId)
              return (
                <div key={m.id} className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-2 text-xs ${
                    m.visibility === 'INTERNAL'
                      ? 'border border-admin-gold/30 bg-admin-gold/10 text-admin-gold'
                      : isCustomer
                        ? 'border border-admin-border bg-admin-surface text-admin-text'
                        : 'bg-ocean-600/20 border border-ocean-500/30 text-admin-text'
                  }`}>
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <span className="font-semibold text-admin-text">{m.author?.fullName ?? (isCustomer ? customerName : 'Support')}</span>
                      {m.visibility === 'INTERNAL' && <span className="text-admin-gold">(internal)</span>}
                    </div>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    {(m.attachments ?? []).map((a) => (
                      <a key={a.id} href={attachmentUrl(a.id)} className="mt-1 flex items-center gap-1.5 text-ocean-400 hover:text-ocean-300" download>
                        <Paperclip className="h-3 w-3" /> {a.filename}
                      </a>
                    ))}
                    <p className="mt-1 text-right text-[10px] text-admin-mutedDim">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Reply box */}
          <div className="border-t border-admin-border p-3">
            <div className="flex items-center gap-2">
              <input className="admin-input flex-1 text-sm" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply…" onKeyDown={(e) => e.key === 'Enter' && sendReply()} />
              <button onClick={sendReply} disabled={sending} className="admin-btn-primary px-4"><Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}</button>
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-admin-mutedDim">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label>
              <label className="flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[11px]" />
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
