import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { useNotifications } from '../store/useStore'
import { Link } from 'react-router-dom'

export function NotificationBell() {
  const { notifications, markNotificationsRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unread = notifications.filter((n) => !n.read).length

  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-slate-300 transition hover:text-white">
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bear px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-2xl animate-slide-up">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            {unread > 0 && <button onClick={() => markNotificationsRead(notifications.map((n) => n.id))} className="text-xs text-ocean-400 hover:text-ocean-300">Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet</p>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <div key={n.id} className={`flex gap-3 border-b border-ink-700/50 px-4 py-3 ${n.read ? '' : 'bg-ocean-500/5'}`}>
                  <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-ink-500' : 'bg-ocean-400'}`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{n.title}</p>
                    <p className="text-xs text-slate-400">{n.body}</p>
                    <p className="mt-1 text-[10px] text-slate-600">{new Date(n.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <Link to="/dashboard" onClick={() => setOpen(false)} className="block border-t border-ink-700 px-4 py-2.5 text-center text-xs font-medium text-ocean-400 hover:bg-ink-800">View dashboard</Link>
        </div>
      )}
    </div>
  )
}
