// Public, read-only CMS data fetching (Phase 4) — talks only to the public
// /cms/* endpoints (never /admin/cms/*), which only ever return PUBLISHED,
// currently-visible content (see backend/src/cms/cms.controller.ts). Kept
// deliberately separate from the admin CMS data-fetching in
// src/pages/admin/CmsPage.tsx.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { CmsPage, CmsAnnouncement, CmsFaq, CmsNavigationItem, CmsSection } from '../types'

function usePublicCms<T>(path: string): { data: T | null; loading: boolean; error: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    api.get<T>(path)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => {
        if (cancelled) return
        // A 404 on a single page (not yet published/created) is a normal,
        // expected empty state — not a network/server error.
        if (e instanceof ApiError && e.status === 404) { setData(null); return }
        setError(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path])

  return { data, loading, error }
}

export function usePublishedPage(slug: string) {
  return usePublicCms<CmsPage>(`/cms/pages/${slug}`)
}

export function usePublishedFaqs() {
  return usePublicCms<CmsFaq[]>('/cms/faqs')
}

export function usePublishedAnnouncements() {
  return usePublicCms<CmsAnnouncement[]>('/cms/announcements')
}

export function useCmsNavigation() {
  return usePublicCms<CmsNavigationItem[]>('/cms/navigation')
}

// ---- Section lookup helpers -------------------------------------------------
// CmsPage.sections is an ordered array of { type, fields } blocks (never raw
// HTML — see backend/src/cms/cms.validation.ts). These just pick out the
// blocks a given part of the UI cares about; unknown/extra section types are
// simply ignored by whichever part of the UI doesn't ask for them.

export function findSection(page: CmsPage | null, type: string): CmsSection | undefined {
  return page?.sections.find((s) => s.type === type)
}

export function findSections(page: CmsPage | null, type: string): CmsSection[] {
  return page?.sections.filter((s) => s.type === type) ?? []
}

export function field(section: CmsSection | undefined, key: string, fallback: string): string {
  const v = section?.fields[key]
  return typeof v === 'string' && v.length > 0 ? v : fallback
}
