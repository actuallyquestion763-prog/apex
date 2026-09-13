import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SupportPage } from './SupportPage'
import { ToastProvider } from '../../components/Toast'
import type { SupportTicket } from '../../types'

const apiGet = vi.fn()
const apiPost = vi.fn()

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return {
    ...actual,
    api: { get: (...args: unknown[]) => apiGet(...args), post: (...args: unknown[]) => apiPost(...args) },
    attachmentUrl: (id: string) => `/attachments/${id}`,
  }
})

const TICKET: SupportTicket = {
  id: 't1', userId: 'u1', categoryId: 'c1', subject: 'Screenshot attached', status: 'OPEN',
  priority: 'NORMAL', requestedPriority: 'NORMAL', assignedAgentId: null,
  createdAt: '2026-09-13T15:08:00.000Z', updatedAt: '2026-09-13T15:32:00.000Z', resolvedAt: null, closedAt: null,
  user: { id: 'u1', email: 'kabwa@example.com', fullName: 'kabwa' },
  messages: [
    {
      id: 'm1', ticketId: 't1', authorId: 'u1', body: 'Attached: photo.png', visibility: 'PUBLIC',
      createdAt: '2026-09-13T15:32:00.000Z', editedAt: null, author: { id: 'u1', email: 'kabwa@example.com', fullName: 'kabwa', role: 'USER' },
      attachments: [{ id: 'a1', messageId: 'm1', filename: 'photo.png', mimeType: 'image/png', size: 1234, createdAt: '2026-09-13T15:32:00.000Z' }],
    },
    {
      id: 'm2', ticketId: 't1', authorId: 'u1', body: 'Attached: notes.pdf', visibility: 'PUBLIC',
      createdAt: '2026-09-13T15:33:00.000Z', editedAt: null, author: { id: 'u1', email: 'kabwa@example.com', fullName: 'kabwa', role: 'USER' },
      attachments: [{ id: 'a2', messageId: 'm2', filename: 'notes.pdf', mimeType: 'application/pdf', size: 5678, createdAt: '2026-09-13T15:33:00.000Z' }],
    },
  ],
}

function renderAdminSupport() {
  return render(<MemoryRouter><ToastProvider><SupportPage /></ToastProvider></MemoryRouter>)
}

describe('Admin SupportPage', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiGet.mockImplementation((path: string) => {
      if (path === '/admin/support/tickets') return Promise.resolve([TICKET])
      if (path === '/admin/support/tickets/t1') return Promise.resolve(TICKET)
      if (path === '/admin/support/agents') return Promise.resolve([])
      return Promise.resolve(null)
    })
  })

  it('no longer shows the "Customer Support" title/description block, but keeps Back to Dashboard', async () => {
    renderAdminSupport()
    expect(await screen.findByText('kabwa')).toBeInTheDocument()
    expect(screen.queryByText('Customer Support')).not.toBeInTheDocument()
    expect(screen.queryByText('Support tickets and live conversation threads.')).not.toBeInTheDocument()
    expect(screen.getByText('Back to Dashboard')).toBeInTheDocument()
  })

  it('renders an image attachment as an actual picture, not just a filename link', async () => {
    renderAdminSupport()
    fireEvent.click(await screen.findByText('kabwa'))
    const img = await screen.findByAltText('photo.png')
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe('/attachments/a1')
  })

  it('renders a non-image attachment as a filename download link, not an image', async () => {
    renderAdminSupport()
    fireEvent.click(await screen.findByText('kabwa'))
    await screen.findByAltText('photo.png')
    expect(screen.getByText('notes.pdf')).toBeInTheDocument()
    expect(screen.queryByAltText('notes.pdf')).not.toBeInTheDocument()
  })
})
