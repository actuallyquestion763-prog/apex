// A thin styling wrapper around the exact `card > overflow-x-auto > table`
// structure every Admin table already used inline — kept intentionally
// non-generic (no typed column/row config) since every table's columns and
// per-row actions are bespoke; this only removes the repeated boilerplate
// wrapper markup and headers, not the row-rendering logic itself.
import type { ReactNode } from 'react'

export function AdminTable({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`admin-card overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  )
}

export function AdminTableHead({ columns }: { columns: { label: string; align?: 'left' | 'right' }[] }) {
  return (
    <thead>
      <tr className="border-b border-admin-border bg-admin-surface text-left text-[11px] uppercase tracking-wide text-admin-mutedDim">
        {columns.map((c) => (
          <th key={c.label} className={`px-4 py-2.5 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
        ))}
      </tr>
    </thead>
  )
}

export function AdminTableRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <tr className={`border-b border-admin-border/60 hover:bg-admin-surface/50 ${className}`}>{children}</tr>
}
