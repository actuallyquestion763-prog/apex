import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LiveChat } from './LiveChat'

// jsdom doesn't implement Element.scrollTo — LiveChat calls it to keep the
// message list scrolled to the bottom; stub it so that effect doesn't throw.
Element.prototype.scrollTo = () => {}

function openChatAndAsk(question: string) {
  render(<LiveChat />)
  fireEvent.click(screen.getByLabelText('Open live chat'))
  const input = screen.getByPlaceholderText('Type a message…')
  fireEvent.change(input, { target: { value: question } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('LiveChat — no false financial claims (P1-5)', () => {
  it('does not claim a deposit bonus exists', async () => {
    openChatAndAsk('is there a bonus')
    await waitFor(() => expect(screen.getByText(/no deposit bonus/i)).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.queryByText(/20%/)).not.toBeInTheDocument()
  })

  it('does not claim leverage is available', async () => {
    openChatAndAsk('what leverage can I use')
    await waitFor(() => expect(screen.getByText(/leveraged trading isn't available/i)).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.queryByText(/100x/)).not.toBeInTheDocument()
  })

  it('does not claim a referral commission is paid', async () => {
    openChatAndAsk('tell me about the referral commission')
    await waitFor(() => expect(screen.getByText(/no commission or reward program/i)).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.queryByText(/10% commission/)).not.toBeInTheDocument()
    expect(screen.queryByText(/paid in real time/i)).not.toBeInTheDocument()
  })

  it('does not reference a hardcoded trust.io support email', async () => {
    openChatAndAsk('I need human support')
    await waitFor(() => expect(screen.getByText(/Support page/i)).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.queryByText(/trust\.io/)).not.toBeInTheDocument()
  })
})
