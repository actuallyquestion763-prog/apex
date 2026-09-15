import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

const FOUND_USER = { id: 'u-new', email: 'newcustomer@example.com', fullName: 'New Customer' }

describe('Admin SupportPage', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiGet.mockImplementation((path: string) => {
      if (path === '/admin/support/tickets') return Promise.resolve([TICKET])
      if (path === '/admin/support/tickets/t1') return Promise.resolve(TICKET)
      if (path === '/admin/support/agents') return Promise.resolve([])
      if (path.startsWith('/admin/support/users')) return Promise.resolve([FOUND_USER])
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

  describe('"Message a user" — contacting a user with no existing ticket', () => {
    it('is hidden until the toggle button is clicked', async () => {
      renderAdminSupport()
      await screen.findByText('kabwa')
      expect(screen.queryByPlaceholderText('Search by name or email…')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Message a user' }))
      expect(screen.getByPlaceholderText('Search by name or email…')).toBeInTheDocument()
    })

    it('searches users and lists results for selection', async () => {
      renderAdminSupport()
      await screen.findByText('kabwa')
      fireEvent.click(screen.getByRole('button', { name: 'Message a user' }))
      fireEvent.change(screen.getByPlaceholderText('Search by name or email…'), { target: { value: 'New' } })
      fireEvent.click(screen.getByRole('button', { name: 'Search' }))
      expect(await screen.findByText('New Customer — newcustomer@example.com')).toBeInTheDocument()
    })

    it('selecting a found user reveals a message box; sending creates a ticket and opens it', async () => {
      apiPost.mockResolvedValue({ id: 't-new' })
      renderAdminSupport()
      await screen.findByText('kabwa')
      fireEvent.click(screen.getByRole('button', { name: 'Message a user' }))
      fireEvent.change(screen.getByPlaceholderText('Search by name or email…'), { target: { value: 'New' } })
      fireEvent.click(screen.getByRole('button', { name: 'Search' }))
      await screen.findByText('New Customer — newcustomer@example.com')

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u-new' } })
      const messageBox = await screen.findByPlaceholderText('Type your message…')
      fireEvent.change(messageBox, { target: { value: 'Hello, following up.' } })
      fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }))

      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/admin/support/tickets', { userId: 'u-new', message: 'Hello, following up.' }))
      // Panel closes and the new ticket becomes selected once created — the
      // "Message a user" search box is gone again.
      await waitFor(() => expect(screen.queryByPlaceholderText('Type your message…')).not.toBeInTheDocument())
    })
  })
})
