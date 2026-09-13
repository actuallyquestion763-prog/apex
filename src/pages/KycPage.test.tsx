import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KycPage } from './KycPage'
import { ToastProvider } from '../components/Toast'

const refresh = vi.fn().mockResolvedValue(undefined)
const refetch = vi.fn().mockResolvedValue(undefined)
let mockUser = { kycStatus: 'NOT_STARTED' }
let mockVerification: any = null

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: mockUser, refresh }),
}))

const submitKycMock = vi.fn()
vi.mock('../store/useKyc', () => ({
  useKycMine: () => ({ verification: mockVerification, loading: false, refetch }),
  submitKyc: (...args: unknown[]) => submitKycMock(...args),
}))

function makeFile(name: string) {
  return new File(['bytes'], name, { type: 'image/png' })
}

function renderKyc() {
  return render(<ToastProvider><KycPage /></ToastProvider>)
}

describe('KycPage', () => {
  beforeEach(() => {
    mockUser = { kycStatus: 'NOT_STARTED' }
    mockVerification = null
    submitKycMock.mockReset()
    refetch.mockClear()
    refresh.mockClear()
  })

  it('requires all identity fields and documents before allowing submission', async () => {
    renderKyc()
    fireEvent.click(screen.getByRole('button', { name: /submit for verification/i }))
    expect(submitKycMock).not.toHaveBeenCalled()
  })

  it('submits with just the front document for a PASSPORT (no back required) and calls the real backend submit function', async () => {
    submitKycMock.mockResolvedValue({ ok: true, data: { id: 'v1', status: 'PENDING' } })
    renderKyc()

    fireEvent.change(screen.getByPlaceholderText('As shown on your ID'), { target: { value: 'Emmika Test' } })
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1995-06-15' } })
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Kenya' } })
    fireEvent.change(screen.getByLabelText('ID type'), { target: { value: 'PASSPORT' } })
    fireEvent.change(screen.getByPlaceholderText('Document number'), { target: { value: 'P1234567' } })

    fireEvent.drop(screen.getByLabelText('Upload ID document'), { dataTransfer: { files: [makeFile('front.png')] } })

    fireEvent.click(screen.getByRole('button', { name: /submit for verification/i }))

    await waitFor(() => expect(submitKycMock).toHaveBeenCalledTimes(1))
    const call = submitKycMock.mock.calls[0][0]
    expect(call.idType).toBe('PASSPORT')
    expect(call.back).toBeNull()
    expect(call.front.name).toBe('front.png')
    expect(call.selfie).toBeUndefined()
  })

  it('no longer shows a Selfie / verification photo upload tile — removed per operator request', () => {
    renderKyc()
    expect(screen.queryByText('Selfie / verification photo')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Upload Selfie / verification photo')).not.toBeInTheDocument()
  })

  it('shows the FRONT and BACK upload tiles for NATIONAL_ID (both required)', () => {
    renderKyc()
    expect(screen.getByText('Front of ID')).toBeInTheDocument()
    expect(screen.getByText('Back of ID')).toBeInTheDocument()
  })

  it('displays the rejection reason and allows resubmission when status is REJECTED', () => {
    mockUser = { kycStatus: 'REJECTED' } as any
    mockVerification = { rejectionReason: 'ID image is blurry.' }
    renderKyc()
    expect(screen.getByText('ID image is blurry.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit for verification/i })).toBeInTheDocument()
  })

  it('does not show the submission form while a verification is PENDING', () => {
    mockUser = { kycStatus: 'PENDING' } as any
    renderKyc()
    expect(screen.queryByRole('button', { name: /submit for verification/i })).not.toBeInTheDocument()
  })
})
