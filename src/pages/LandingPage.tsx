import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { PriceTicker } from '../components/PriceTicker'
import { LiveChat } from '../components/LiveChat'
import { useAuth } from '../store/auth'
import { ShieldCheck, Zap, BarChart3, ArrowRight, Check, ChevronDown, Users, Award, Lock, Globe, TrendingUp, Star, Quote, Wallet } from 'lucide-react'

const FAQ = [
  { q: 'Is TRUST a regulated platform?', a: 'TRUST is registered with the fictional Digital Asset Authority and complies with international AML/KYC standards. Client funds are held in segregated cold-storage wallets.' },
  { q: 'How long do deposits take?', a: 'USDT deposits confirm within 10–30 minutes on the TRC-20 network. Bank transfers take 1–3 business days, and card deposits are instant.' },
  { q: 'What are the trading fees?', a: 'Trading fees start at 0.1% per transaction. Fees decrease with higher trading volume.' },
  { q: 'How much starting balance do I get?', a: 'New accounts start at $0 — deposit funds to fund your account, or ask an administrator about a demo credit for exploring the platform.' },
  { q: 'How does the referral program work?', a: 'Share your unique referral link. You earn 10% commission on every trade made by users you refer, credited in real time to your balance.' },
  { q: 'How do I open a position?', a: 'Pick a market on the Trade page, enter your amount, and choose Buy or Sell. Your position updates in real time with the live market price until you close it.' },
]

const TESTIMONIALS = [
  { name: 'Marcus T.', role: 'Day Trader', text: 'The execution speed on TRUST is unreal. Charts update in real time and the order panel is the cleanest I have used.', rating: 5 },
  { name: 'Priya K.', role: 'Crypto Investor', text: 'Signing up took seconds and depositing was straightforward. The deposit bonus was a nice surprise.', rating: 5 },
  { name: 'David L.', role: 'Active Trader', text: 'Clean execution and real-time pricing. This is the platform I keep coming back to.', rating: 5 },
  { name: 'Sofia R.', role: 'Referral Partner', text: 'The 10% referral commission pays out instantly. I have built a steady side income just by sharing my link.', rating: 5 },
]

const PARTNERS = ['CoinDesk', 'Bloomberg', 'Reuters', 'Forbes', 'TechCrunch', 'WSJ']

export function LandingPage() {
  const { user } = useAuth()
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    const target = new Date(); target.setHours(target.getHours() + 23, target.getMinutes() + 59, 59)
    const id = setInterval(() => {
      const diff = target.getTime() - Date.now()
      const h = Math.floor(diff / 3_600_000), m = Math.floor((diff % 3_600_000) / 60_000), s = Math.floor((diff % 60_000) / 1000)
      setCountdown(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen">
      <PriceTicker />
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
              <Link to="/dashboard" className="btn-gold">Dashboard <ArrowRight className="h-4 w-4" /></Link>
            ) : (
              <><Link to="/login" className="btn-ghost">Sign in</Link><Link to="/signup" className="btn-gold">Get started <ArrowRight className="h-4 w-4" /></Link></>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-ocean-500/10 blur-[120px]" />
          <div className="absolute right-0 top-40 h-[400px] w-[400px] rounded-full bg-gold-500/10 blur-[100px]" />
        </div>
        <div className="mx-auto max-w-7xl px-4 py-20 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="animate-fade-in">
              <div className="chip mb-6 border-gold-500/30 bg-gold-500/10 text-gold-300"><ShieldCheck className="h-3.5 w-3.5" /> Registered · ISO 27001 Certified</div>
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">Trade crypto with <span className="bg-gradient-to-r from-gold-300 to-gold-500 bg-clip-text text-transparent">confidence</span></h1>
              <p className="mt-5 max-w-lg text-lg text-slate-400">The institutional-grade trading platform. Deep liquidity, 100x leverage, and bank-grade security — all in one elegant interface.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/signup" className="btn-gold text-base px-6 py-3">Open free account <ArrowRight className="h-5 w-5" /></Link>
                <a href="#how" className="btn-ghost text-base px-6 py-3">See how it works</a>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-6 text-sm text-slate-500">
                <span className="flex items-center gap-2"><Users className="h-4 w-4 text-ocean-400" /> 2.4M+ traders</span>
                <span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-bull" /> $18B+ volume</span>
                <span className="flex items-center gap-2"><Globe className="h-4 w-4 text-gold-400" /> 140+ countries</span>
              </div>
            </div>
            <div className="animate-slide-up">
              <div className="card relative overflow-hidden p-6">
                <div className="flex items-center justify-between mb-4">
                  <div><p className="text-sm text-slate-400">BTC/USDT</p><p className="font-mono text-3xl font-bold text-white">$67,250.40</p></div>
                  <span className="rounded-lg bg-bull/15 px-2.5 py-1 text-sm font-semibold text-bull">+2.84%</span>
                </div>
                <div className="flex h-40 items-end gap-1.5">
                  {[40, 55, 48, 62, 70, 58, 75, 82, 68, 90, 85, 95, 78, 88, 96, 100, 92, 105, 98, 112].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-ocean-600/40 to-ocean-400/80" style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-ink-800 p-2.5"><p className="text-xs text-slate-500">24h High</p><p className="font-mono text-sm font-semibold text-white">$68,420</p></div>
                  <div className="rounded-lg bg-ink-800 p-2.5"><p className="text-xs text-slate-500">24h Low</p><p className="font-mono text-sm font-semibold text-white">$65,890</p></div>
                  <div className="rounded-lg bg-ink-800 p-2.5"><p className="text-xs text-slate-500">Volume</p><p className="font-mono text-sm font-semibold text-white">$42.8B</p></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust badges / partners */}
      <section className="border-y border-ink-700/60 bg-ink-900/50">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <p className="mb-6 text-center text-xs font-semibold uppercase tracking-widest text-slate-500">As featured in</p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {PARTNERS.map((p) => <span key={p} className="text-lg font-bold text-slate-600 transition hover:text-slate-400">{p}</span>)}
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
            { n: 2, title: 'Deposit funds', desc: 'Add funds via USDT, bank transfer, or card. Get a 20% bonus on your first deposit of $500 or more.', icon: Wallet },
            { n: 3, title: 'Start trading', desc: 'Access live charts, 100x leverage, and instant order execution across 8+ top cryptocurrencies.', icon: BarChart3 },
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
            {[
              { icon: Zap, title: 'Instant execution', desc: 'Sub-millisecond order matching with deep liquidity pools.' },
              { icon: BarChart3, title: 'Pro charts', desc: 'Real-time candlestick charts with 1m, 5m, and 1h timeframes.' },
              { icon: Lock, title: 'Bank-grade security', desc: 'Cold storage, 2FA, and withdrawal whitelisting keep your funds safe.' },
              { icon: Award, title: 'Low fees', desc: '0.1% per trade. Volume discounts available.' },
            ].map((f) => (
              <div key={f.title} className="card p-6 transition hover:border-ocean-500/40">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ocean-500/15 text-ocean-400"><f.icon className="h-5 w-5" /></div>
                <h3 className="mt-4 font-bold text-white">{f.title}</h3>
                <p className="mt-1.5 text-sm text-slate-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Deposit bonus banner */}
      <section className="mx-auto max-w-7xl px-4 py-12">
        <div className="relative overflow-hidden rounded-2xl border border-gold-500/30 bg-gradient-to-r from-gold-500/10 via-ink-850 to-ink-850 p-8">
          <div className="absolute right-0 top-0 h-full w-1/3 bg-gold-500/5 blur-3xl" />
          <div className="relative flex flex-col items-center justify-between gap-6 md:flex-row">
            <div>
              <div className="chip mb-3 border-gold-500/40 bg-gold-500/15 text-gold-300">Limited time offer</div>
              <h3 className="text-2xl font-bold text-white">Deposit $500, get a 20% bonus</h3>
              <p className="mt-1 text-slate-400">Bonus credited instantly to your trading balance. Ends in:</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-4xl font-bold text-gold-400">{countdown || '23:59:59'}</p>
              <Link to="/signup" className="btn-gold mt-4">Claim bonus <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="border-y border-ink-700/60 bg-ink-900/40">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Trusted by traders worldwide</h2>
            <div className="mt-3 flex items-center justify-center gap-1.5">
              {[1,2,3,4,5].map((i) => <Star key={i} className="h-5 w-5 fill-gold-400 text-gold-400" />)}
              <span className="ml-2 text-slate-400">4.9/5 from 12,400+ reviews</span>
            </div>
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
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <div className="chip mb-4 border-ocean-500/30 bg-ocean-500/10 text-ocean-300"><Users className="h-3.5 w-3.5" /> Affiliate Program</div>
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Earn 10% commission on every trade</h2>
            <p className="mt-4 text-slate-400">Invite friends and fellow traders with your unique referral link. You earn 10% of the trading fees generated by every user you refer — for life. Commissions are credited in real time.</p>
            <ul className="mt-6 space-y-3">
              {['Real-time commission payouts', 'Lifetime recurring earnings', 'Detailed analytics dashboard', 'No earning cap'].map((b) => (
                <li key={b} className="flex items-center gap-3 text-slate-300"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-bull/20 text-bull"><Check className="h-3 w-3" /></span>{b}</li>
              ))}
            </ul>
            <Link to="/signup" className="btn-gold mt-8">Become an affiliate <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <div className="card p-8">
            <p className="text-sm text-slate-400">Your potential monthly earnings</p>
            <div className="mt-4 space-y-4">
              {[{ refs: 10, avg: '$500', earn: '$1,500' }, { refs: 50, avg: '$1,000', earn: '$7,500' }, { refs: 200, avg: '$2,500', earn: '$30,000' }].map((row) => (
                <div key={row.refs} className="flex items-center justify-between rounded-xl bg-ink-800 p-4">
                  <div><p className="font-semibold text-white">{row.refs} referrals</p><p className="text-xs text-slate-500">Avg. monthly volume: {row.avg}</p></div>
                  <p className="font-mono text-xl font-bold text-gold-400">{row.earn}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-ink-700/60 bg-ink-900/40">
        <div className="mx-auto max-w-3xl px-4 py-20">
          <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">Frequently asked questions</h2>
          <div className="mt-10 space-y-3">
            {FAQ.map((item, i) => (
              <div key={i} className="card overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="flex w-full items-center justify-between px-5 py-4 text-left">
                  <span className="font-medium text-white">{item.q}</span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && <div className="px-5 pb-4 text-sm leading-relaxed text-slate-400 animate-fade-in">{item.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <div className="relative overflow-hidden rounded-3xl border border-ink-700 bg-gradient-to-br from-ink-850 via-ink-850 to-ocean-700/20 p-12 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to start trading?</h2>
          <p className="mx-auto mt-3 max-w-md text-slate-400">Join 2.4 million traders. Open your free account in seconds.</p>
          <Link to="/signup" className="btn-gold mt-8 text-base px-8 py-3">Create free account <ArrowRight className="h-5 w-5" /></Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink-700/60 bg-ink-950">
        <div className="mx-auto max-w-7xl px-4 py-12">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <Logo />
              <p className="mt-4 text-sm text-slate-500">The institutional-grade crypto trading platform. Trade with confidence.</p>
              <div className="mt-4 flex gap-2">
                <span className="chip"><ShieldCheck className="h-3 w-3 text-bull" /> Regulated</span>
                <span className="chip"><Lock className="h-3 w-3 text-ocean-400" /> ISO 27001</span>
              </div>
            </div>
            <div><p className="mb-3 text-sm font-semibold text-white">Product</p><ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#features" className="hover:text-white">Features</a></li>
              <li><Link to="/signup" className="hover:text-white">Open account</Link></li>
              <li><a href="#how" className="hover:text-white">How it works</a></li>
              <li><a href="#faq" className="hover:text-white">FAQ</a></li>
            </ul></div>
            <div><p className="mb-3 text-sm font-semibold text-white">Company</p><ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#" className="hover:text-white">About us</a></li><li><a href="#" className="hover:text-white">Careers</a></li>
              <li><a href="#" className="hover:text-white">Press</a></li><li><a href="#" className="hover:text-white">Partnerships</a></li>
            </ul></div>
            <div><p className="mb-3 text-sm font-semibold text-white">Legal</p><ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#" className="hover:text-white">Terms of service</a></li><li><a href="#" className="hover:text-white">Privacy policy</a></li>
              <li><a href="#" className="hover:text-white">AML policy</a></li><li><a href="#" className="hover:text-white">Risk disclosure</a></li>
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
