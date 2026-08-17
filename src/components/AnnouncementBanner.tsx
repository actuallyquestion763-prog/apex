import { useState } from 'react'
import { X, Megaphone } from 'lucide-react'
import { usePublishedAnnouncements } from '../lib/cms'
import type { CmsAnnouncement } from '../types'

// Renders currently-visible, published CMS announcements (Part 6). Audience
// (loggedInOnly) and the visibility window (startAt/endAt) are both already
// enforced server-side (see backend/src/cms/cms.service.ts's
// listPublishedAnnouncements) — this component only ever receives
// announcements it's allowed to show. Dismissal is local/session-only UI
// state (not a backend read-receipt), stored per announcement id so a
// dismissed announcement stays dismissed across a page reload but a NEW
// announcement always shows.
const DISMISS_KEY = 'trust_dismissed_announcements'

function loadDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') } catch { return [] }
}

function dismiss(id: string) {
  const next = Array.from(new Set([...loadDismissed(), id]))
  localStorage.setItem(DISMISS_KEY, JSON.stringify(next))
}

const PRIORITY_STYLE: Record<CmsAnnouncement['priority'], string> = {
  URGENT: 'border-bear/30 bg-bear/10 text-bear',
  HIGH: 'border-gold-500/30 bg-gold-500/10 text-gold-300',
  NORMAL: 'border-ocean-500/30 bg-ocean-500/10 text-ocean-300',
  LOW: 'border-ink-600 bg-ink-800 text-slate-300',
}

export function AnnouncementBanner() {
  const { data } = usePublishedAnnouncements()
  const [, forceRerender] = useState(0)
  const dismissed = loadDismissed()

  const visible = (data ?? []).filter((a) => !dismissed.includes(a.id))
  if (visible.length === 0) return null

  return (
    <div className="space-y-1 px-4 pt-3">
      {visible.map((a) => (
        <div key={a.id} className={`mx-auto flex max-w-7xl items-start gap-3 rounded-xl border px-4 py-2.5 text-sm ${PRIORITY_STYLE[a.priority]}`}>
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">{a.title}</span>
            <span className="ml-2 text-current/90">{a.body}</span>
          </div>
          <button onClick={() => { dismiss(a.id); forceRerender((n) => n + 1) }} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
