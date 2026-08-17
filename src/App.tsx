import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './store/auth'
import { LandingPage } from './pages/LandingPage'
import { SignupPage } from './pages/SignupPage'
import { LoginPage } from './pages/LoginPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import { TwoFactorSetupPage } from './pages/TwoFactorSetupPage'
import { TwoFactorVerifyPage } from './pages/TwoFactorVerifyPage'
import { DashboardLayout } from './components/DashboardLayout'
import { DashboardPage } from './pages/DashboardPage'
import HomePage from './pages/HomePage'
import MarketsPage from './pages/MarketsPage'
import TradePage from './pages/TradePage'
import AssetsPage from './pages/AssetsPage'
import { WalletPage } from './pages/WalletPage'
import { ProfilePage } from './pages/ProfilePage'
import { DepositPage } from './pages/DepositPage'
import { WithdrawPage } from './pages/WithdrawPage'
import { KycPage } from './pages/KycPage'
import { SupportPage } from './pages/SupportPage'
import { AdminPage } from './pages/AdminPage'
import { CmsPageView } from './pages/CmsPageView'

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex min-h-screen items-center justify-center"><p className="text-slate-500">Loading…</p></div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex min-h-screen items-center justify-center"><p className="text-slate-500">Loading…</p></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'USER') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pages/:slug" element={<CmsPageView />} />
      <Route path="/verify-email" element={<Protected><VerifyEmailPage /></Protected>} />
      <Route path="/2fa-setup" element={<Protected><TwoFactorSetupPage /></Protected>} />
      <Route path="/2fa-verify" element={<TwoFactorVerifyPage />} />
      <Route element={<Protected><DashboardLayout /></Protected>}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/dashboard" element={<HomePage />} />
        <Route path="/markets" element={<MarketsPage />} />
        <Route path="/trade" element={<TradePage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/deposit" element={<DepositPage />} />
        <Route path="/withdraw" element={<WithdrawPage />} />
        <Route path="/kyc" element={<KycPage />} />
        <Route path="/support" element={<SupportPage />} />
      </Route>
      <Route path="/admin" element={<AdminOnly><AdminPage /></AdminOnly>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
