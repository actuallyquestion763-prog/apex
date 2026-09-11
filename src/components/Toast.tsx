import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'
interface Toast { id: string; kind: ToastKind; message: string }

const ToastContext = createContext<{ push: (kind: ToastKind, message: string) => void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, kind, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="animate-slide-up flex items-start gap-3 rounded-xl border border-ink-600 bg-ink-800/90 backdrop-blur-md px-4 py-3 shadow-xl min-w-[280px] max-w-sm">
            {t.kind === 'success' && <CheckCircle2 className="mt-0.5 h-5 w-5 text-bull shrink-0" />}
            {t.kind === 'error' && <AlertTriangle className="mt-0.5 h-5 w-5 text-bear shrink-0" />}
            {t.kind === 'info' && <Info className="mt-0.5 h-5 w-5 text-ocean-400 shrink-0" />}
            <p className="text-sm text-slate-200 flex-1">{t.message}</p>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-slate-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
