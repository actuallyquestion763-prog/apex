import type { LucideIcon } from 'lucide-react'

export function EmptyState({ icon: Icon, title, hint }: { icon?: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {Icon && <Icon className="h-7 w-7 text-slate-600" />}
      <p className="text-sm font-medium text-slate-400">{title}</p>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  )
}
