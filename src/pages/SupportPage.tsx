import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, attachmentUrl } from '../lib/api'
import { useToast } from '../components/Toast'
import { EmptyState } from '../components/EmptyState'
import { NotificationBell } from '../components/NotificationBell'
import { useVisualViewportBox } from '../lib/useVisualViewport'
import type { SupportTicket, SupportCategory } from '../types'
import { Headset, Send, ArrowLeft, Paperclip, X } from 'lucide-react'

// Customer-facing support is a single, ongoing "chat with Support Team" —
// never a ticket inbox the customer has to navigate (operator-specified
// design). Under the hood it's still backed by SupportTicket/SupportMessage
// rows (never /admin/support/* — the backend enforces ownership on every
// one of these calls regardless of what the frontend does or doesn't show,
// see backend/src/support/support.service.ts), but the customer never sees
// a ticket list, a category/priority picker, or a "new ticket" form: the
// most recent non-closed ticket (if any) IS the conversation, and sending
// a first message with none yet silently creates one.
export function SupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null)
  const [categories, setCategories] = useState<SupportCategory[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
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
      setError(e instanceof ApiError ? e.message : 'Could not load support.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refetch() }, [refetch])

  // Picks the most-recently-updated NON-closed ticket as "the" conversation.
  // A closed ticket is treated the same as having none — sending a message
  // then starts a fresh one, so the customer is never stuck staring at a
  // dead thread with no way to reach support again.
  useEffect(() => {
    if (!tickets) return
    setActiveId((prev) => {
      if (prev && tickets.some((t) => t.id === prev && t.status !== 'CLOSED')) return prev
      const openOnes = tickets.filter((t) => t.status !== 'CLOSED').sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      return openOnes[0]?.id ?? null
    })
  }, [tickets])

  if (loading) {
    return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950 text-sm text-slate-500">Loading…</div>
  }
  if (error) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950 p-6 text-center">
        <p className="text-sm text-bear">{error}</p>
      </div>
    )
  }

  const active = tickets?.find((t) => t.id === activeId) ?? null

  return (
    <SupportChat
      ticket={active}
      categories={categories}
      onTicketCreated={(id) => { setActiveId(id); refetch() }}
      onChanged={refetch}
    />
  )
}

// Full-screen chat takeover — matches the operator's reference design
// exactly: a dedicated "Support Team / Online" header (Back + notification
// bell), an edge-to-edge message thread, and a fixed message composer.
// `fixed inset-0` deliberately covers DashboardLayout's header/price-ticker
// and BottomNav (mobile) rather than living inside the normal padded
// <main> — this IS the full-screen view the design calls for, not a card
// embedded in the page. z-[60] beats BottomNav's z-50 regardless of DOM
// order; LiveChat's floating bubble (z-[9999]) still floats above this too,
// same as it does on every other page.
function SupportChat({
  ticket, categories, onTicketCreated, onChanged,
}: {
  ticket: SupportTicket | null
  categories: SupportCategory[]
  onTicketCreated: (id: string) => void
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const { push } = useToast()
  const [detail, setDetail] = useState<SupportTicket | null>(null)
  const [reply, setReply] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)

  // The parent's `ticket` is a LIST-level row (no messages) — this always
  // fetches the full detail (with messages) rather than trusting that prop
  // directly, same as the original ticket-detail view did.
  const loadDetail = useCallback(async (id: string) => {
    try { setDetail(await api.get<SupportTicket>(`/support/tickets/${id}`)) } catch { /* keep last known state */ }
  }, [])

  useEffect(() => {
    if (ticket) loadDetail(ticket.id)
    else setDetail(null)
  }, [ticket?.id, loadDetail])

  async function send() {
    if (!reply.trim() && !file) return
    setSending(true)
    try {
      // A closed ticket is never reused — sending into it would just be
      // rejected by the backend, and the customer has no ticket-list UI to
      // fall back to, so a closed conversation must transparently start a
      // fresh one instead of becoming a dead end.
      const existingId = detail && detail.status !== 'CLOSED' ? detail.id : null
      if (!existingId) {
        const category = categories[0]
        if (!category) { push('error', 'Support is not available right now.'); return }
        const created = await api.post<SupportTicket>('/support/tickets', {
          categoryId: category.id,
          subject: 'Support Chat',
          // Ticket creation always needs its own non-empty text message
          // (the backend contract has no "create with just a file" path) —
          // when starting a brand-new conversation with only a file, this
          // is the opening message; the file itself follows right after as
          // its own message (the backend auto-captions that one).
          message: reply.trim() || 'Sent an attachment.',
          requestedPriority: 'NORMAL',
        })
        if (file) {
          const form = new FormData()
          form.append('file', file)
          await api.postForm(`/support/tickets/${created.id}/attachments`, form)
        }
        setReply('')
        setFile(null)
        onTicketCreated(created.id)
        await loadDetail(created.id)
        return
      }
      if (file) {
        const form = new FormData()
        form.append('file', file)
        if (reply.trim()) form.append('body', reply)
        await api.postForm(`/support/tickets/${existingId}/attachments`, form)
      } else {
        await api.post(`/support/tickets/${existingId}/messages`, { body: reply })
      }
      setReply('')
      setFile(null)
      await loadDetail(existingId)
      onChanged()
    } catch (e) {
      push('error', e instanceof ApiError ? e.message : 'Could not send message.')
    } finally {
      setSending(false)
    }
  }

  const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  // When a mobile on-screen keyboard is open, pin this full-screen layer to
  // the part of the screen that's actually visible so the composer stays
  // above the keyboard instead of behind it (null = ordinary `inset-0`).
  const visible = useVisualViewportBox()

  return (
    <div
      className="fixed inset-0 z-[60] flex w-full max-w-full flex-col bg-gradient-to-b from-ink-900 via-ink-850 to-ink-950"
      style={visible ? { top: visible.top, height: visible.height, bottom: 'auto' } : undefined}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-ink-700/60 bg-ink-900/90 px-4 py-3 backdrop-blur-md">
        <button onClick={() => navigate('/home')} className="flex items-center gap-1.5 text-sm font-bold text-ocean-300 transition hover:text-ocean-200">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-bull/15 text-bull"><Headset className="h-4 w-4" /></div>
          <div>
            <p className="text-sm font-bold text-white">Support Team</p>
            <p className="flex items-center gap-1 text-[11px] font-medium text-bull"><span className="h-1.5 w-1.5 rounded-full bg-bull" /> Online</p>
          </div>
        </div>
        <NotificationBell />
      </div>

      {/* Every level from here down is min-w-0 / min-h-0 on purpose: a flex
          child defaults to min-width:auto (= its content's width), so without
          it one long unbroken string, filename or wide image forces its whole
          row — and the page — wider than the phone instead of wrapping. */}
      <div data-testid="support-thread" className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4">
        {(detail?.messages ?? []).length === 0 ? (
          <EmptyState icon={Headset} title="No messages yet" hint="Send a message below to reach our support team." />
        ) : (detail?.messages ?? []).map((m) => {
          const own = m.authorId === detail?.userId
          return (
            <div key={m.id} className={`flex min-w-0 ${own ? 'justify-end' : 'justify-start'}`}>
              <div className={`min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm sm:max-w-[78%] ${own ? 'bg-gradient-to-br from-ocean-500 to-ocean-600 text-white' : 'bg-ink-800 text-slate-200'}`}>
                <p className={`mb-0.5 text-[11px] font-bold [overflow-wrap:anywhere] ${own ? 'text-white/85' : 'text-ocean-300'}`}>{m.author?.fullName ?? (own ? 'You' : 'Support')}</p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere] [word-break:break-word]">{m.body}</p>
                {(m.attachments ?? []).map((a) => (
                  <a key={a.id} href={attachmentUrl(a.id)} target="_blank" rel="noreferrer" className="mt-1.5 block min-w-0 max-w-full">
                    {a.mimeType.startsWith('image/') ? (
                      <img src={attachmentUrl(a.id)} alt={a.filename} className="block h-auto max-h-64 w-auto max-w-full rounded-lg object-cover" />
                    ) : (
                      <span className="flex min-w-0 items-start gap-1.5 text-xs underline opacity-90 hover:opacity-100">
                        <Paperclip className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">{a.filename}</span>
                      </span>
                    )}
                  </a>
                ))}
                <p className={`mt-1 text-[10px] ${own ? 'text-white/60' : 'text-slate-500'}`}>{timeLabel(m.createdAt)}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="min-w-0 shrink-0 border-t border-ink-700/60 bg-ink-900/90 p-3">
        {detail?.status === 'CLOSED' && (
          <p className="mb-2 text-center text-[11px] text-slate-500">That conversation was closed — sending a message starts a new one.</p>
        )}
        {file && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs text-slate-300">
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button onClick={() => setFile(null)} aria-label="Remove attachment" className="text-slate-500 hover:text-white"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:text-white" aria-label="Attach a file">
            <Paperclip className="h-5 w-5" />
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
          </label>
          {/* min-w-0: an <input> has an intrinsic width that flex won't shrink
              below by default. text-base on phones: iOS zooms the whole page
              when a focused field's font is under 16px, which is itself a
              cause of "the chat is wider than the screen". */}
          <input
            className="min-w-0 flex-1 rounded-full border border-ink-600 bg-ink-800 px-4 py-2.5 text-base text-white placeholder-slate-500 outline-none focus:border-ocean-500 sm:text-sm"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Type a message…"
          />
          <button onClick={send} disabled={sending} aria-label="Send message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-500 text-ink-950 transition hover:bg-gold-400 disabled:opacity-50"><Send className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  )
}
