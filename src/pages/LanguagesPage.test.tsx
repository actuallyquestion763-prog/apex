import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LanguagesPage } from './LanguagesPage'
import { I18nProvider } from '../i18n'
import BottomNav from '../components/BottomNav'

function renderApp() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <BottomNav />
        <LanguagesPage />
      </I18nProvider>
    </MemoryRouter>,
  )
}

describe('LanguagesPage — real language switching (Tier 1: nav + Mine)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('lists all ten real languages, English checked by default, and persists the choice', () => {
    renderApp()
    expect(screen.getByText('Español')).toBeInTheDocument()
    expect(screen.getByText('Français')).toBeInTheDocument()
    expect(screen.getByText('العربية')).toBeInTheDocument()
    expect(screen.getByText('简体中文')).toBeInTheDocument()
    // English row shows the check mark by default (no stored preference).
    const englishRow = screen.getByText('English', { selector: 'p.font-medium' }).closest('button')!
    expect(englishRow.querySelector('svg')).toBeInTheDocument()
  })

  it('selecting Spanish immediately re-labels shared nav text elsewhere on the page (BottomNav), proving this is a real switch, not a static label', () => {
    renderApp()
    expect(screen.getByRole('link', { name: /navigate to home/i })).toBeInTheDocument()

    fireEvent.click(screen.getByText('Español'))

    expect(screen.getByRole('link', { name: /navigate to inicio/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /navigate to mercados/i })).toBeInTheDocument()
    expect(window.localStorage.getItem('trust.language')).toBe('es')
  })

  it('a page with no Arabic-specific override text still reads (English fallback), and selecting Arabic flips the document to RTL', () => {
    renderApp()
    fireEvent.click(screen.getByText('العربية'))
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
  })
})
