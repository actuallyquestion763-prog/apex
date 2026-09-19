import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
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

  // ---- A message the support team edited: the customer just sees the new text ----

  describe('after support edits a message', () => {
    // As returned to a customer after an edit: only the current wording. Even
    // if a payload carried a non-null editedAt, nothing may render it.
    const EDITED_TICKET: SupportTicket = {
      ...OPEN_TICKET,
      messages: [
        OPEN_TICKET.messages![0],
        {
          id: 'm9', ticketId: 't1', authorId: 'agent1', body: 'Your withdrawal was approved.', visibility: 'PUBLIC',
          createdAt: '2026-09-13T15:20:00.000Z', editedAt: '2026-09-13T15:30:00.000Z', author: { id: 'agent1', email: 'agent@b.com', fullName: 'Support Agent' },
        },
      ],
    }

    it('shows only the updated message — no "Edited" label, no timestamp change, no history text', async () => {
      mockBackend([EDITED_TICKET])
      renderSupport()
      expect(await screen.findByText('Your withdrawal was approved.')).toBeInTheDocument()
      expect(screen.queryByText(/edit/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/previous|original|history|revised|updated at/i)).not.toBeInTheDocument()
      const bubble = screen.getByText('Your withdrawal was approved.').parentElement as HTMLElement
      expect(bubble.textContent).toContain(new Date('2026-09-13T15:20:00.000Z').toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
    })

    it('gives the customer no way to edit any message — no menu on right-click, no editor, no edit control', async () => {
      mockBackend([EDITED_TICKET])
      renderSupport()
      const agentText = await screen.findByText('Your withdrawal was approved.')
      fireEvent.contextMenu(agentText.parentElement as HTMLElement)
      fireEvent.contextMenu(screen.getByText('hi').parentElement as HTMLElement)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.queryByText('Edit message')).not.toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: /edit/i })).not.toBeInTheDocument()
    })
  })

  // ---- Mobile layout ----------------------------------------------------
  // jsdom does no layout, so these pin the width constraints that make the
  // chat shrink correctly on a phone (also verified in a real browser at
  // phone widths): every flex level allowed to shrink, text that breaks
  // anywhere, media capped to its container, and a composer that can't
  // outgrow the screen or hide behind the keyboard.
  describe('mobile layout', () => {
    const LONG_TOKEN = 'https://example.com/' + 'a'.repeat(160)
    const LONG_FILENAME = `${'scanned-passport-front-page-'.repeat(6)}final.pdf`
    const LONG_TICKET: SupportTicket = {
      ...OPEN_TICKET,
      messages: [
        { id: 'l1', ticketId: 't1', authorId: 'u1', body: LONG_TOKEN, visibility: 'PUBLIC', createdAt: '2026-09-13T15:08:00.000Z', editedAt: null, author: { id: 'u1', email: 'a@b.com', fullName: 'iaosehina' } },
        {
          id: 'l2', ticketId: 't1', authorId: 'agent1', body: 'Here you go', visibility: 'PUBLIC', createdAt: '2026-09-13T15:09:00.000Z', editedAt: null, author: { id: 'agent1', email: 'agent@b.com', fullName: 'Support Agent' },
          attachments: [
            { id: 'a7', messageId: 'l2', filename: LONG_FILENAME, mimeType: 'application/pdf', size: 1, createdAt: '2026-09-13T15:09:00.000Z' },
            { id: 'a8', messageId: 'l2', filename: 'wide.png', mimeType: 'image/png', size: 1, createdAt: '2026-09-13T15:09:00.000Z' },
          ],
        },
      ],
    }

    it('the chat is a full-viewport layer whose thread and composer can shrink to the phone width', async () => {
      mockBackend([LONG_TICKET])
      renderSupport()
      await screen.findByText(LONG_TOKEN)
      const thread = screen.getByTestId('support-thread')
      expect(thread).toHaveClass('min-w-0', 'min-h-0', 'flex-1', 'overflow-y-auto')
      const root = thread.parentElement as HTMLElement
      expect(root).toHaveClass('fixed', 'inset-0', 'w-full', 'max-w-full')
      expect(root.getAttribute('style')).toBeNull() // ordinary inset-0 when no keyboard is open
    })

    it('incoming and outgoing bubbles are capped to the available width and wrap very long unbroken text', async () => {
      mockBackend([LONG_TICKET])
      renderSupport()
      const own = (await screen.findByText(LONG_TOKEN)) as HTMLElement
      const incoming = screen.getByText('Here you go')
      for (const text of [own, incoming]) {
        const bubble = text.parentElement as HTMLElement
        expect(bubble).toHaveClass('min-w-0', 'max-w-[85%]', 'sm:max-w-[78%]')
        expect(bubble.parentElement).toHaveClass('min-w-0')
      }
      expect(own.className).toContain('[overflow-wrap:anywhere]')
      expect(own.className).toContain('whitespace-pre-wrap')
    })

    it('long filenames wrap inside the bubble, and images shrink to fit it', async () => {
      mockBackend([LONG_TICKET])
      renderSupport()
      const name = await screen.findByText(LONG_FILENAME)
      expect(name.className).toContain('[overflow-wrap:anywhere]')
      expect(name.className).toContain('min-w-0')
      expect(name.closest('a')).toHaveClass('min-w-0', 'max-w-full')
      const img = screen.getByAltText('wide.png')
      expect(img).toHaveClass('max-w-full', 'h-auto')
      expect(img.getAttribute('src')).toBe('/attachments/a8') // attachment link/behavior unchanged
      expect(name.closest('a')?.getAttribute('href')).toBe('/attachments/a7')
    })

    it('the composer fits the phone: shrinkable input, 16px text on phones (no iOS focus-zoom), attach + send stay reachable', async () => {
      mockBackend([LONG_TICKET])
      renderSupport()
      await screen.findByText(LONG_TOKEN)
      const input = screen.getByPlaceholderText('Type a message…')
      expect(input).toHaveClass('min-w-0', 'flex-1', 'text-base', 'sm:text-sm')
      expect(input.parentElement).toHaveClass('min-w-0')
      expect(screen.getByRole('button', { name: 'Send message' })).toHaveClass('shrink-0')
      expect(screen.getByLabelText('Attach a file')).toHaveClass('shrink-0')
    })

    it('a long attached filename in the composer chip truncates instead of widening the composer', async () => {
      mockBackend([LONG_TICKET])
      renderSupport()
      await screen.findByText(LONG_TOKEN)
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(fileInput, { target: { files: [new File(['x'], LONG_FILENAME, { type: 'application/pdf' })] } })
      const chipName = await screen.findByText(LONG_FILENAME, { selector: 'span.truncate' })
      expect(chipName).toHaveClass('min-w-0', 'flex-1', 'truncate')
    })

    describe('on-screen keyboard', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'visualViewport')
      afterEach(() => {
        if (original) Object.defineProperty(window, 'visualViewport', original)
        else delete (window as unknown as { visualViewport?: unknown }).visualViewport
      })

      function fakeViewport(height: number, offsetTop = 0) {
        const listeners = new Map<string, Set<() => void>>()
        const vv = {
          height, offsetTop,
          addEventListener: (t: string, cb: () => void) => { (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(cb) },
          removeEventListener: (t: string, cb: () => void) => { listeners.get(t)?.delete(cb) },
          fire: (t: string) => listeners.get(t)?.forEach((cb) => cb()),
        }
        Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
        return vv
      }

      it('pins the chat to the visible area while the keyboard is open, so the composer stays above it, and releases it afterwards', async () => {
        const vv = fakeViewport(window.innerHeight) // keyboard closed
        mockBackend([LONG_TICKET])
        renderSupport()
        await screen.findByText(LONG_TOKEN)
        const root = screen.getByTestId('support-thread').parentElement as HTMLElement
        expect(root.getAttribute('style')).toBeNull()

        act(() => { vv.height = 300; vv.offsetTop = 0; vv.fire('resize') }) // keyboard opens
        expect(root.style.height).toBe('300px')
        expect(root.style.top).toBe('0px')
        expect(root.style.bottom).toBe('auto')

        act(() => { vv.offsetTop = 40; vv.fire('scroll') }) // page nudged while typing (iOS)
        expect(root.style.top).toBe('40px')

        act(() => { vv.height = window.innerHeight; vv.offsetTop = 0; vv.fire('resize') }) // keyboard closes
        expect(root.style.height).toBe('')
        expect(root.style.top).toBe('')
        expect(root.style.bottom).toBe('')
      })

      it('is a no-op in browsers without the visualViewport API', async () => {
        delete (window as unknown as { visualViewport?: unknown }).visualViewport
        mockBackend([LONG_TICKET])
        renderSupport()
        await screen.findByText(LONG_TOKEN)
        expect(screen.getByTestId('support-thread').parentElement!.getAttribute('style')).toBeNull()
      })
    })
  })
})
