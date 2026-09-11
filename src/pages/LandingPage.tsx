import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { PriceTicker } from '../components/PriceTicker'
import { LiveChat } from '../components/LiveChat'
import { AnnouncementBanner } from '../components/AnnouncementBanner'
import { useAuth } from '../store/auth'
import { usePublishedPage, usePublishedFaqs, useCmsNavigation, findSection, findSections, field } from '../lib/cms'
import { ShieldCheck, Zap, BarChart3, ArrowRight, ChevronDown, Users, Award, Lock, Star, Quote, Wallet } from 'lucide-react'
import { snapshot, getStats24h } from '../store/priceFeed'

// Structural UI stays in code (icons, layout, animation) — only marketing
// COPY comes from the CMS (Part 2/4 of the Phase 4 spec: "CMS should
// control content, not application behavior"). These are the fallback
// values shown if the CMS's "homepage" page hasn't been published or fails
// to load — a deliberate resilience choice for non-critical marketing copy,
// distinct from the FAQ/legal pages below, which show a safe empty/error
// state instead of ever inventing content (Part 5/7).
const FALLBACK_HERO = { badge: 'Demo Platform · No Real Funds', title: 'Trade crypto with confidence', subtitle: 'A clean, fast interface for spot crypto trading, backed by a real order and ledger system.', ctaLabel: 'Open free account', ctaHref: '/signup' }
const FALLBACK_TRUST = { badge1: 'Demo Platform', badge2: 'No Real Funds' }
const FALLBACK_CTA = { title: 'Ready to start trading?', subtitle: 'Open your free account in seconds.', ctaLabel: 'Create free account', ctaHref: '/signup' }
const FALLBACK_FOOTER = { tagline: 'The institutional-grade crypto trading platform. Trade with confidence.' }
const FEATURE_ICONS = [Zap, BarChart3, Lock, Award]
const FALLBACK_FEATURES = [
  { title: 'Instant execution', desc: 'Orders are placed directly with the connected execution provider and reflected in your account right away.' },
  { title: 'Pro charts', desc: 'Real-time candlestick charts with 1m, 5m, and 1h timeframes.' },
  { title: 'Account security', desc: 'Two-factor authentication adds a strong layer of protection to your account.' },
  { title: 'Low fees', desc: '0.1% per trade.' },
]

const TESTIMONIALS = [
  { name: 'Marcus T.', role: 'Day Trader', text: 'The execution speed on TRUST is unreal. Charts update in real time and the order panel is the cleanest I have used.', rating: 5 },
  { name: 'Priya K.', role: 'Crypto Investor', text: 'Signing up took seconds and depositing was straightforward.', rating: 5 },
  { name: 'David L.', role: 'Active Trader', text: 'Clean execution and real-time pricing. This is the platform I keep coming back to.', rating: 5 },
]

export function LandingPage() {
  const { user } = useAuth()
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const { data: homepage } = usePublishedPage('homepage')
  const { data: faqs, loading: faqsLoading, error: faqsError } = usePublishedFaqs()
  const { data: navItems } = useCmsNavigation()

  // The hero price card reads module-level priceFeed state, which is
  // populated by an async fetch after this component's first render — a
  // plain read here would freeze on the initial (empty) snapshot forever.
  // Re-rendering on an interval, same pattern as MarketsPage.tsx, is what
  // actually lets the real price replace the honest "—" placeholder once it
  // arrives.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1500)
    return () => clearInterval(id)
  }, [])

  const hero = { ...FALLBACK_HERO, ...findSection(homepage, 'hero')?.fields }
  const heroTicker = snapshot().find((p) => p.symbol === 'BTC/USDT')
  const heroStats = getStats24h('BTC/USDT')
  const trust = { ...FALLBACK_TRUST, ...findSection(homepage, 'trust')?.fields }
  const cta = { ...FALLBACK_CTA, ...findSection(homepage, 'cta')?.fields }
  const footer = { ...FALLBACK_FOOTER, ...findSection(homepage, 'footer')?.fields }
  const cmsFeatures = findSections(homepage, 'feature')
  const features = cmsFeatures.length > 0
    ? cmsFeatures.map((s, i) => ({ icon: FEATURE_ICONS[i % FEATURE_ICONS.length], title: field(s, 'title', ''), desc: field(s, 'desc', '') }))
    : FALLBACK_FEATURES.map((f, i) => ({ icon: FEATURE_ICONS[i], ...f }))

  function navHref(label: string, fallbackHref: string): string {
    return navItems?.find((n) => n.label === label)?.destination ?? fallbackHref
  }

  return (
    <div className="min-h-screen">
      <PriceTicker />
      <AnnouncementBanner />
      <header className="sticky top-0 z-40 border-b border-ink-700/60 bg-ink-900/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5">
          <Link to="/"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a href="#features" className="hover:text-white transition">Features</a>
            <a href="#how" className="hover:text-white transition">How it works</a>
            <a href="#testimonials" className="hover:text-white transition">Reviews</a>
            <a href="#faq" className="hover:text-white transition">FAQ</a>
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                {/* Lets a signed-in visitor reach the login form directly —
                    e.g. to sign into a different account — without first
                    having to sign out (LoginPage doesn't force a redirect
                    away from an existing session). */}
                <Link to="/login" className="btn-ghost">Log in</Link>
                <Link to="/dashboard" className="btn-gold">Dashboard <ArrowRight className="h-4 w-4" /></Link>
              </>
            ) : (
              <><Link to="/login" className="btn-ghost">Sign in</Link><Link to="/signup" className="btn-gold">Get started <ArrowRight className="h-4 w-4" /></Link></>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-ocean-500/25 blur-[120px]" />
          <div className="absolute right-0 top-40 h-[400px] w-[400px] rounded-full bg-gold-500/10 blur-[100px]" />
        </div>
        <div className="mx-auto max-w-7xl px-4 py-20 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="animate-fade-in">
              <div className="chip mb-6 border-gold-500/30 bg-gold-500/10 text-gold-300"><ShieldCheck className="h-3.5 w-3.5" /> {hero.badge}</div>
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">{hero.title}</h1>
              <p className="mt-5 max-w-lg text-lg text-slate-400">{hero.subtitle}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to={hero.ctaHref} className="btn-gold text-base px-6 py-3">{hero.ctaLabel} <ArrowRight className="h-5 w-5" /></Link>
                <a href="#how" className="btn-ghost text-base px-6 py-3">See how it works</a>
              </div>
            </div>
            <div className="animate-slide-up">
              <div className="card relative overflow-hidden p-6">
                <div className="flex items-center justify-between mb-4">
                  <div><p className="text-sm text-slate-400">BTC/USDT</p><p className="font-mono text-3xl font-bold text-white">{heroTicker && heroTicker.price > 0 ? `$${heroTicker.price.toLocaleString(undefined, { maximumFractionDigits: heroTicker.price < 1 ? 4 : 2 })}` : '—'}</p></div>
                  {heroTicker && heroTicker.price > 0 && (
                    <span className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${heroTicker.changePct >= 0 ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear'}`}>{heroTicker.changePct >= 0 ? '+' : ''}{heroTicker.changePct.toFixed(2)}%</span>
                  )}
                </div>
                <div className="flex h-40 items-end gap-1.5">
                  {[40, 55, 48, 62, 70, 58, 75, 82, 68, 90, 85, 95, 78, 88, 96, 100, 92, 105, 98, 112].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-ocean-600/40 to-ocean-400/80" style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-ink-800 p-2.5"><p className="text-xs text-slate-500">24h High</p><p className="font-mono text-sm font-semibold text-white">{heroStats.highPrice != null ? `$${heroStats.highPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}</p></div>
                  <div className="rounded-lg bg-ink-800 p-2.5"><p className="text-xs text-slate-500">24h Low</p><p className="font-mono text-sm font-semibold text-white">{heroStats.lowPrice != null ? `$${heroStats.lowPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}</p></div>
                  <div className="rounded-lg bg-ink-800 p-2.5"><p className="text-xs text-slate-500">Volume</p><p className="font-mono text-sm font-semibold text-white">{heroStats.quoteVolume != null ? `$${heroStats.quoteVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</p></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-7xl px-4 py-20">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Start Trading in 3 Easy Steps</h2>
          <p className="mt-3 text-slate-400">From sign-up to your first trade in under two minutes.</p>
        </div>
        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {[
            { n: 1, title: 'Create your account', desc: 'Sign up with your email and verify your identity. Your account starts at $0 — no balance is created automatically.', icon: ShieldCheck },
            { n: 2, title: 'Deposit funds', desc: 'Add USDT from the Deposit page. Deposits are credited after admin verification.', icon: Wallet },
            { n: 3, title: 'Start trading', desc: 'Access live charts and instant order execution across 8+ top cryptocurrencies.', icon: BarChart3 },
          ].map((s) => (
            <div key={s.n} className="card group relative p-8 transition hover:border-gold-500/40">
              <div className="absolute -top-4 left-8 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-gold-400 to-gold-500 font-bold text-ink-950 shadow-lg">{s.n}</div>
              <s.icon className="h-10 w-10 text-gold-400" />
              <h3 className="mt-5 text-xl font-bold text-white">{s.title}</h3>
              <p className="mt-2 text-slate-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-ink-700/60 bg-ink-900/40">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Built for serious traders</h2>
            <p className="mt-3 text-slate-400">Everything you need to trade with an edge.</p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div key={f.title} className="card p-6 transition hover:border-ocean-500/40">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ocean-500/15 text-ocean-400"><f.icon className="h-5 w-5" /></div>
                <h3 className="mt-4 font-bold text-white">{f.title}</h3>
                <p className="mt-1.5 text-sm text-slate-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="border-y border-ink-700/60 bg-ink-900/40">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Trusted by traders worldwide</h2>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="card p-6">
                <Quote className="h-7 w-7 text-gold-400/40" />
                <p className="mt-3 text-sm leading-relaxed text-slate-300">"{t.text}"</p>
                <div className="mt-4 flex items-center gap-1">{Array.from({ length: t.rating }).map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-gold-400 text-gold-400" />)}</div>
                <div className="mt-4 flex items-center gap-3 border-t border-ink-700 pt-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ocean-600 text-sm font-bold text-white">{t.name.slice(0,1)}</div>
                  <div><p className="text-sm font-semibold text-white">{t.name}</p><p className="text-xs text-slate-500">{t.role}</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Referral section */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="chip mx-auto mb-4 border-ocean-500/30 bg-ocean-500/10 text-ocean-300"><Users className="h-3.5 w-3.5" /> Referrals</div>
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Share your referral link</h2>
          <p className="mt-4 text-slate-400">Every account gets a unique referral link, available from your Dashboard after you sign up.</p>
          <Link to="/signup" className="btn-gold mt-8">Create free account <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>

      {/* FAQ — sourced from the CMS (published only); never a fabricated
          fallback list if this fails to load (Part 5 of the Phase 4 spec) */}
      <section id="faq" className="border-t border-ink-700/60 bg-ink-900/40">
        <div className="mx-auto max-w-3xl px-4 py-20">
          <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">Frequently asked questions</h2>
          <div className="mt-10 space-y-3">
            {faqsLoading ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
            ) : faqsError ? (
              <p className="py-8 text-center text-sm text-slate-500">FAQs are temporarily unavailable. Please check back shortly.</p>
            ) : (faqs ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No FAQs published yet.</p>
            ) : (faqs ?? []).map((item, i) => (
              <div key={item.id} className="card overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="flex w-full items-center justify-between px-5 py-4 text-left">
                  <span className="font-medium text-white">{item.question}</span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && <div className="px-5 pb-4 text-sm leading-relaxed text-slate-400 animate-fade-in">{item.answer}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <div className="relative overflow-hidden rounded-3xl border border-ink-700 bg-gradient-to-br from-ink-850 via-ink-850 to-ocean-700/20 p-12 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">{cta.title}</h2>
          <p className="mx-auto mt-3 max-w-md text-slate-400">{cta.subtitle}</p>
          <Link to={cta.ctaHref} className="btn-gold mt-8 text-base px-8 py-3">{cta.ctaLabel} <ArrowRight className="h-5 w-5" /></Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink-700/60 bg-ink-950">
        <div className="mx-auto max-w-7xl px-4 py-12">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <Logo />
              <p className="mt-4 text-sm text-slate-500">{footer.tagline}</p>
              <div className="mt-4 flex gap-2">
                <span className="chip"><ShieldCheck className="h-3 w-3 text-bull" /> {trust.badge1}</span>
                <span className="chip"><Lock className="h-3 w-3 text-ocean-400" /> {trust.badge2}</span>
              </div>
            </div>
            <div><p className="mb-3 text-sm font-semibold text-white">Product</p><ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#features" className="hover:text-white">Features</a></li>
              <li><Link to="/signup" className="hover:text-white">Open account</Link></li>
              <li><a href="#how" className="hover:text-white">How it works</a></li>
              <li><a href="#faq" className="hover:text-white">FAQ</a></li>
            </ul></div>
            <div><p className="mb-3 text-sm font-semibold text-white">Company</p><ul className="space-y-2 text-sm text-slate-500">
              <li><Link to={navHref('About', '/pages/about')} className="hover:text-white">About us</Link></li>
              <li><Link to={navHref('Help', '/pages/help')} className="hover:text-white">Help center</Link></li>
              <li><Link to={navHref('Contact', '/pages/contact')} className="hover:text-white">Contact</Link></li>
            </ul></div>
            <div><p className="mb-3 text-sm font-semibold text-white">Legal</p><ul className="space-y-2 text-sm text-slate-500">
              <li><Link to={navHref('Terms', '/pages/terms')} className="hover:text-white">Terms of service</Link></li>
              <li><Link to={navHref('Privacy', '/pages/privacy')} className="hover:text-white">Privacy policy</Link></li>
              <li><Link to={navHref('Risk Disclosure', '/pages/risk-disclosure')} className="hover:text-white">Risk disclosure</Link></li>
            </ul></div>
          </div>
          <div className="mt-10 border-t border-ink-700 pt-6 text-center text-xs text-slate-600">
            <p>TRUST is a fictional demonstration platform. No real funds are involved. © 2026 TRUST Technologies.</p>
          </div>
        </div>
      </footer>
      <LiveChat />
    </div>
  )
}
