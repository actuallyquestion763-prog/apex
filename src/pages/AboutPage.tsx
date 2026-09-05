import { Logo } from '../components/Logo'
import pkg from '../../package.json'

interface Section {
  heading: string
  body?: string
  bullets?: string[]
}

const SECTIONS: Section[] = [
  {
    heading: 'Agreement to Terms',
    body: 'TRUST and its affiliates provide blockchain technology services through websites and mobile applications. By accessing or using our Services you acknowledge that you have read, understood and accepted these Terms. If you do not agree with these Terms, please discontinue using our Services. We do not provide financial advice, investment advice or trading advice. Every cryptocurrency transaction is completely your own responsibility.',
  },
  {
    heading: 'Privacy Policy',
    body: 'We respect your privacy. Personal information is collected only for providing better services, improving security and complying with applicable laws and regulations. We do not sell your personal data. Your information is protected using industry-standard security practices.',
  },
  {
    heading: 'Eligibility',
    bullets: [
      'You must be at least 18 years old.',
      'You must have full legal capacity.',
      'You agree to comply with the laws of your country.',
      'You are responsible for protecting your own account.',
      'Never share your password or wallet credentials.',
    ],
  },
  {
    heading: 'Digital Assets',
    body: 'Cryptocurrency and digital assets are highly volatile. Prices may rise or fall dramatically within a short period of time. Blockchain transactions are generally irreversible once confirmed. Always verify wallet addresses, blockchain networks and transaction amounts before sending assets. TRUST is not responsible for losses caused by incorrect wallet addresses, wrong networks or user mistakes.',
  },
  {
    heading: 'Risk Warning',
    body: 'Trading digital assets involves substantial financial risk. The value of cryptocurrencies can increase or decrease rapidly. You should carefully evaluate your financial situation before making any investment decisions. Never invest more money than you can afford to lose.',
  },
  {
    heading: 'Disclaimer',
    body: 'TRUST provides technology services only. We do not guarantee profits, investment returns or future market performance. We are not responsible for losses resulting from user mistakes, forgotten passwords, private key loss, phishing attacks, blockchain failures or network congestion. Every transaction is initiated entirely by the user.',
  },
  {
    heading: 'Compliance',
    body: 'We reserve the right to suspend, restrict or terminate accounts that violate applicable laws, these Terms of Service or our internal policies. Identity verification (KYC) may be required where required by law.',
  },
]

export function AboutPage() {
  return (
    <div className="space-y-6">
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <Logo size="lg" />
        <p className="text-xs text-slate-500">Version {pkg.version}</p>
      </div>

      <div className="card space-y-6 p-6">
        {SECTIONS.map((s) => (
          <div key={s.heading}>
            <h2 className="font-bold text-gold-400">{s.heading}</h2>
            {s.body && <p className="mt-2 text-sm leading-relaxed text-slate-300">{s.body}</p>}
            {s.bullets && (
              <ul className="mt-2 space-y-1.5">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-2 text-sm text-slate-300">
                    <span className="text-slate-500">•</span>{b}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        <div className="border-t border-ink-700/60 pt-4 text-center text-xs text-slate-500">
          <p className="text-ocean-300">© {new Date().getFullYear()} TRUST</p>
          <p>All Rights Reserved</p>
        </div>
      </div>
    </div>
  )
}

export default AboutPage
