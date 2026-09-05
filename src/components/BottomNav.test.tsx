import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from './BottomNav'
import { I18nProvider } from '../i18n'

function renderNav() {
  return render(<MemoryRouter><I18nProvider><BottomNav /></I18nProvider></MemoryRouter>)
}

describe('BottomNav (mobile navigation)', () => {
  it('renders exactly Home, Markets, Trade, Assets, Mine — no Options', () => {
    renderNav()
    expect(screen.getByRole('link', { name: /navigate to home/i })).toHaveAttribute('href', '/home')
    expect(screen.getByRole('link', { name: /navigate to markets/i })).toHaveAttribute('href', '/markets')
    expect(screen.getByRole('link', { name: /navigate to trade/i })).toHaveAttribute('href', '/trade')
    expect(screen.getByRole('link', { name: /navigate to assets/i })).toHaveAttribute('href', '/assets')
    expect(screen.getByRole('link', { name: /navigate to mine/i })).toHaveAttribute('href', '/profile')
  })

  it('never renders an Options tab or a link to /options', () => {
    renderNav()
    expect(screen.queryByText('Options')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /options/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /navigate to options/i })).not.toBeInTheDocument()
  })
})
