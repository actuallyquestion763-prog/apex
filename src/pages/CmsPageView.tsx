import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '../components/Logo'
import { usePublishedPage, findSections } from '../lib/cms'

// Generic public renderer for any CMS-managed page (about/help/contact/
// terms/privacy/risk-disclosure, or any future one) at /pages/:slug. Only
// ever fetches the public, published-only /cms/pages/:slug endpoint (Part
// 7) — a draft or archived page is a 404 here exactly as it is server-side,
// never rendered. `sections` are structured blocks (never raw HTML — see
// backend/src/cms/cms.validation.ts), so this only ever interpolates plain
// text into JSX, which React already escapes; there is no dangerouslySetInnerHTML
// anywhere in this component.
export function CmsPageView() {
  const { slug } = useParams<{ slug: string }>()
  const { data: page, loading, error } = usePublishedPage(slug ?? '')

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-700/60 bg-ink-900/80 px-4 py-3.5">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link to="/"><Logo /></Link>
          <Link to="/" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back home</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-16">
        {loading ? (
          <p className="text-center text-sm text-slate-500">Loading…</p>
        ) : error ? (
          <div className="card p-8 text-center">
            <p className="text-sm font-semibold text-bear">This page is temporarily unavailable.</p>
            <p className="mt-2 text-xs text-slate-500">Please try again shortly.</p>
          </div>
        ) : !page ? (
          <div className="card p-8 text-center">
            <p className="text-sm font-semibold text-white">Page not found</p>
            <p className="mt-2 text-xs text-slate-500">This page doesn't exist or hasn't been published yet.</p>
          </div>
        ) : (
          <article>
            <h1 className="text-3xl font-bold text-white">{page.title}</h1>
            <div className="mt-6 space-y-5">
              {findSections(page, 'text').map((s, i) => (
                <p key={i} className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{String(s.fields.body ?? '')}</p>
              ))}
            </div>
          </article>
        )}
      </main>

      <footer className="border-t border-ink-700/60 py-8 text-center text-xs text-slate-600">
        TRUST is a fictional demonstration platform. No real funds are involved.
      </footer>
    </div>
  )
}

export default CmsPageView
