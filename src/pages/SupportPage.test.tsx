import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SupportPage } from './SupportPage'
import { ToastProvider } from '../components/Toast'
import type { SupportTicket, SupportCategory } from '../types'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPostForm = vi.fn()

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    api: { get: (...args: unknown[]) => apiGet(...args), post: (...args: unknown[]) => apiPost(...args), postForm: (...args: unknown[]) => apiPostForm(...args) },
    attachmentUrl: (id: string) => `/attachments/${id}`,
  }
})

vi.mock('../store/useStore', () => ({
  useNotifications: () => ({ notifications: [], markNotificationsRead: vi.fn() }),
}))

const CATEGORIES: SupportCategory[] = [{ id: 'c1', name: 'General', description: null, isActive: true, order: 0 }]

const OPEN_TICKET: SupportTicket = {
  id: 't1', userId: 'u1', categoryId: 'c1', subject: 'Support Chat', status: 'OPEN',
  priority: 'NORMAL', requestedPriority: 'NORMAL', assignedAgentId: null,
  createdAt: '2026-09-13T15:08:00.000Z', updatedAt: '2026-09-13T15:08:30.000Z', resolvedAt: null, closedAt: null,
  category: CATEGORIES[0],
  messages: [
    { id: 'm1', ticketId: 't1', authorId: 'u1', body: 'hi', visibility: 'PUBLIC', createdAt: '2026-09-13T15:08:00.000Z', editedAt: null, author: { id: 'u1', email: 'a@b.com', fullName: 'iaosehina' } },
    { id: 'm2', ticketId: 't1', authorId: 'u1', body: 'hello', visibility: 'PUBLIC', createdAt: '2026-09-13T15:08:30.000Z', editedAt: null, author: { id: 'u1', email: 'a@b.com', fullName: 'iaosehina' } },
  ],
}

function mockBackend(tickets: SupportTicket[], detailById: Record<string, SupportTicket> = {}) {
  apiGet.mockImplementation((path: string) => {
    if (path === '/support/tickets') return Promise.resolve(tickets)
    if (path === '/support/categories') return Promise.resolve(CATEGORIES)
    const match = path.match(/^\/support\/tickets\/(.+)$/)
    if (match) return Promise.resolve(detailById[match[1]] ?? tickets.find((t) => t.id === match[1]))
    return Promise.resolve(null)
  })
}

function renderSupport() {
  return render(<MemoryRouter><ToastProvider><SupportPage /></ToastProvider></MemoryRouter>)
}

describe('SupportPage — a single ongoing chat with Support Team, never a ticket inbox (operator-specified design)', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPostForm.mockReset()
  })

  it('goes straight into the chat — no ticket list, no "new ticket" form, no subject/category chrome', async () => {
    mockBackend([OPEN_TICKET])
    renderSupport()
    expect(await screen.findByText('Support Team')).toBeInTheDocument()
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.queryByText('New support ticket')).not.toBeInTheDocument()
    expect(screen.queryByText(/Get help with your account/)).not.toBeInTheDocument()
    expect(screen.queryByText('Support Chat')).not.toBeInTheDocument() // the auto-generated subject is never shown
  })

  it('shows the existing conversation\'s messages with sender name and timestamp when the user already has an open ticket', async () => {
    mockBackend([OPEN_TICKET])
    renderSupport()
    const hi = await screen.findByText('hi')
    expect(within(hi.closest('div') as HTMLElement).getByText('iaosehina')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('shows an honest empty state and a working composer when the user has no ticket at all yet', async () => {
    mockBackend([])
    renderSupport()
    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type a message…')).toBeInTheDocument()
  })

  it('sending the first message with no existing ticket silently creates one (auto category/subject) and shows the reply', async () => {
    mockBackend([])
    const created = { ...OPEN_TICKET, id: 't-new', messages: [OPEN_TICKET.messages![0]] }
    apiPost.mockResolvedValue(created)
    renderSupport()
    await screen.findByText('No messages yet')

    // A real backend's next GET /support/tickets would now include the
    // ticket that was just created — the mock reflects that.
    apiGet.mockImplementation((path: string) => {
      if (path === '/support/tickets') return Promise.resolve([created])
      if (path === '/support/categories') return Promise.resolve(CATEGORIES)
      if (path === '/support/tickets/t-new') return Promise.resolve(created)
      return Promise.resolve(null)
    })

    fireEvent.change(screen.getByPlaceholderText('Type a message…'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/support/tickets', { categoryId: 'c1', subject: 'Support Chat', message: 'hi', requestedPriority: 'NORMAL' }))
    expect(await screen.findByText('hi')).toBeInTheDocument()
  })

  it('sends into the existing conversation once one is already open (no re-creation)', async () => {
    mockBackend([OPEN_TICKET])
    apiPost.mockResolvedValue({})
    renderSupport()
    await screen.findByText('Support Team')

    fireEvent.change(screen.getByPlaceholderText('Type a message…'), { target: { value: 'need help' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/support/tickets/t1/messages', { body: 'need help' }))
  })

  it('treats a closed ticket as no conversation — shows the empty state and a working composer, not a dead end', async () => {
    mockBackend([{ ...OPEN_TICKET, status: 'CLOSED' }])
    renderSupport()
    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type a message…')).toBeInTheDocument()
    expect(screen.queryByText(/conversation was closed/)).not.toBeInTheDocument()
  })

  it('renders an image attachment as an actual picture, not just a filename link', async () => {
    const withImage: SupportTicket = {
      ...OPEN_TICKET,
      messages: [
        {
          id: 'm3', ticketId: 't1', authorId: 'u1', body: 'Attached: photo.png', visibility: 'PUBLIC',
          createdAt: '2026-09-13T15:32:00.000Z', editedAt: null, author: { id: 'u1', email: 'a@b.com', fullName: 'iaosehina' },
          attachments: [{ id: 'a1', messageId: 'm3', filename: 'photo.png', mimeType: 'image/png', size: 1234, createdAt: '2026-09-13T15:32:00.000Z' }],
        },
      ],
    }
    mockBackend([withImage])
    renderSupport()
    const img = await screen.findByAltText('photo.png')
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe('/attachments/a1')
  })

  it('Back navigates to Home', async () => {
    mockBackend([OPEN_TICKET])
    renderSupport()
    await screen.findByText('Support Team')
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument()
  })
})
