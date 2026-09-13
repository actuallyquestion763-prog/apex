import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SupportFab } from './SupportFab'

function renderAt(pathname: string) {
  return render(<MemoryRouter initialEntries={[pathname]}><SupportFab /></MemoryRouter>)
}

describe('SupportFab — floating Support entry point', () => {
  it('renders a link to /support on an ordinary page', () => {
    renderAt('/home')
    const link = screen.getByRole('link', { name: 'Support' })
    expect(link).toHaveAttribute('href', '/support')
  })

  it('hides itself while already on the Support page — a self-link would be pointless there', () => {
    renderAt('/support')
    expect(screen.queryByRole('link', { name: 'Support' })).not.toBeInTheDocument()
  })
})
