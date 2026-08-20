import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { ChevronRight, FileText, Shield, AlertTriangle, Headset } from 'lucide-react'
import pkg from '../../package.json'

// Links to the existing CMS pages (already seeded at /pages/terms,
// /pages/privacy, /pages/risk-disclosure, /pages/about, /pages/contact) —
// content lives there once, not duplicated here.
const LINKS = [
  { to: '/pages/about', label: 'About TRUST', icon: FileText },
  { to: '/pages/terms', label: 'Terms & Conditions', icon: FileText },
  { to: '/pages/privacy', label: 'Privacy Policy', icon: Shield },
  { to: '/pages/risk-disclosure', label: 'Risk Disclosure', icon: AlertTriangle },
  { to: '/pages/contact', label: 'Support / Contact', icon: Headset },
]

export function AboutPage() {
  return (
    <div className="space-y-6">
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <Logo size="lg" />
        <p className="text-xs text-slate-500">Version {pkg.version}</p>
        <p className="max-w-md text-sm text-slate-400">TRUST is a fictional demonstration trading platform. No real funds, broker, exchange, or payment provider are connected — every balance and trade exists only within this demo.</p>
      </div>

      <div className="card overflow-hidden">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="flex items-center gap-3 border-b border-ink-700/60 px-5 py-4 text-sm text-slate-300 transition last:border-b-0 hover:bg-ink-800/40 hover:text-white">
            <l.icon className="h-4 w-4 shrink-0 text-slate-500" />
            <span className="flex-1 font-medium">{l.label}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
          </Link>
        ))}
      </div>
    </div>
  )
}
