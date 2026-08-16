import { useEffect, useRef, useState } from 'react'
import { MessageSquare, X, Send, Bot } from 'lucide-react'

interface Msg { from: 'bot' | 'me'; text: string }

const SCRIPTED: { keys: string[]; reply: string }[] = [
  { keys: ['deposit', 'fund', 'add money', 'top up'], reply: "You can deposit via USDT (TRC-20), bank transfer, or card. Go to the Deposit page and scan the QR code for your chosen method. Deposits are credited within 10–30 minutes after network confirmation." },
  { keys: ['withdraw', 'cash out', 'payout'], reply: "To withdraw, head to the Withdraw page and enter your destination address. Withdrawals are reviewed by our team and typically process within 24 hours." },
  { keys: ['kyc', 'verify', 'identity', 'document'], reply: "KYC verification keeps your account secure. Upload a clear photo of the front and back of your government-issued ID on the Verification page. Review takes 1–2 business days." },
  { keys: ['bonus', 'promot', '20%'], reply: "Right now we're running a deposit bonus: deposit $500 or more and receive a 20% bonus credited to your account. See the banner on the Deposit page for the countdown." },
  { keys: ['leverage', 'margin'], reply: "You can trade with leverage from 1x up to 100x. Use the leverage slider on the trade panel. Higher leverage increases both potential profit and liquidation risk." },
  { keys: ['2fa', 'two factor', 'authenticator'], reply: "Enable 2FA from your account security page by scanning the QR code with Google Authenticator or a similar app. It adds a strong layer of protection to withdrawals and account changes." },
  { keys: ['referral', 'affiliate', 'commission'], reply: "Earn 10% commission on every trade made by users you refer. Share your referral link from the dashboard — commissions are paid in real time to your balance." },
  { keys: ['support', 'help', 'human', 'agent'], reply: "Our support team is available 24/7. For account-specific issues, email support@trust.io and include your account email so we can locate your profile." },
  { keys: ['secure', 'safe', 'regulated', 'license'], reply: "TRUST is registered with the fictional Digital Asset Authority and holds ISO 27001 certification for information security. Client funds are held in segregated cold-storage wallets." },
  { keys: ['demo', 'practice', 'test'], reply: "New accounts start at $0 — deposit funds to explore the platform. This account isn't connected to a real broker or exchange, so no real money is involved." },
]

function reply(input: string): string {
  const q = input.toLowerCase()
  const hit = SCRIPTED.find((s) => s.keys.some((k) => q.includes(k)))
  return hit ? hit.reply : "Thanks for reaching out! A support agent will review your message. In the meantime, you can ask me about deposits, withdrawals, KYC, bonuses, leverage, 2FA, or referrals."
}

export function LiveChat() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'bot', text: "Hi! I'm Trustie, your TRUST assistant. Ask me anything about deposits, withdrawals, KYC, or trading." }])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [msgs, typing])

  function send() {
    if (!input.trim()) return
    const text = input.trim()
    setMsgs((m) => [...m, { from: 'me', text }])
    setInput('')
    setTyping(true)
    setTimeout(() => { setTyping(false); setMsgs((m) => [...m, { from: 'bot', text: reply(text) }]) }, 900)
  }

  return (
    <>
      <button onClick={() => setOpen((o) => !o)} className="fixed bottom-5 right-5 z-[150] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-gold-400 to-gold-500 text-ink-950 shadow-xl shadow-gold-500/30 transition hover:scale-105 animate-pulse-glow" aria-label="Open live chat">
        {open ? <X className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
      </button>
      {open && (
        <div className="fixed bottom-24 right-5 z-[150] flex h-[460px] w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 shadow-2xl animate-slide-up">
          <div className="flex items-center gap-3 border-b border-ink-700 bg-ink-800 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/20 text-gold-400"><Bot className="h-5 w-5" /></div>
            <div>
              <p className="text-sm font-semibold text-white">Vaultie · Support</p>
              <p className="flex items-center gap-1.5 text-xs text-bull"><span className="h-1.5 w-1.5 rounded-full bg-bull" /> Online now</p>
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === 'me' ? 'bg-ocean-600 text-white' : 'bg-ink-700 text-slate-200'}`}>{m.text}</div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-ink-700 px-3 py-2.5">
                  <div className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-ink-700 bg-ink-800 p-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Type a message…" className="flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-ocean-500" />
            <button onClick={send} className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-500 text-ink-950 hover:bg-gold-400"><Send className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </>
  )
}
