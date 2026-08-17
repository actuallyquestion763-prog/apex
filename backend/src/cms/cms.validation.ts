import { BadRequestException } from '@nestjs/common'

// Server-side content safety for everything CMS-editable. Nothing here is
// optional/best-effort — every page/announcement/FAQ save and every
// navigation-item destination goes through this. There is deliberately no
// "raw HTML" field anywhere in the CMS models for an admin to fill in — see
// CmsPage.sections — so the main job here is stripping any HTML/script an
// admin's browser might still submit in a plain text field, and validating
// that link destinations can't become an XSS vector or point somewhere unsafe.

const TAG_PATTERN = /<[^>]*>/g

// Strips any HTML tags from a plain-text field (titles, body copy, FAQ
// answers, etc.) — these are rendered as text, never as innerHTML, so a
// stripped tag couldn't execute anyway, but stripping server-side means the
// stored data itself is never HTML, which is the safer invariant to hold.
export function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') throw new BadRequestException('Expected a text value.')
  return input.replace(TAG_PATTERN, '').trim()
}

export function sanitizeOptionalText(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined
  return sanitizeText(input)
}

// A destination is safe if it is either:
//  - an internal, same-origin path starting with a single "/" (never "//",
//    which browsers treat as protocol-relative and could point off-site), or
//  - an external https:// URL (no http:, javascript:, data:, vbscript:, or
//    any other scheme).
// Anything else (bare "javascript:alert(1)", "//evil.com", relative paths
// without a leading slash, etc.) is rejected outright, not sanitized —
// there's no safe way to "clean up" a malicious destination, only reject it.
export function validateDestination(input: unknown): string {
  const value = sanitizeText(input)
  if (value.startsWith('/')) {
    if (value.startsWith('//')) throw new BadRequestException('Internal destinations must not start with "//".')
    return value
  }
  if (/^https:\/\//i.test(value)) return value
  throw new BadRequestException('Destination must be an internal path starting with "/" or an https:// URL.')
}

// ---- Page sections ----------------------------------------------------------
// Structured content blocks, not a page builder. Each section has a `type`
// from a fixed allowlist and a flat `fields` object of string/number/boolean
// leaves only — no nested arbitrary structures, no HTML.

export const SECTION_TYPES = ['hero', 'feature', 'stats', 'cta', 'text', 'trust', 'faq_teaser', 'footer'] as const
export type SectionType = (typeof SECTION_TYPES)[number]

export interface CmsSection {
  type: SectionType
  fields: Record<string, string | number | boolean>
}

const LINK_FIELD_NAMES = new Set(['href', 'ctaHref', 'url', 'link', 'destination'])

export function validateSections(input: unknown): CmsSection[] {
  if (!Array.isArray(input)) throw new BadRequestException('sections must be an array.')
  return input.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) throw new BadRequestException(`sections[${index}] must be an object.`)
    const { type, fields } = raw as Record<string, unknown>
    if (typeof type !== 'string' || !SECTION_TYPES.includes(type as SectionType)) {
      throw new BadRequestException(`sections[${index}].type must be one of: ${SECTION_TYPES.join(', ')}.`)
    }
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      throw new BadRequestException(`sections[${index}].fields must be a flat object.`)
    }
    const cleanFields: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
      if (typeof value === 'number' || typeof value === 'boolean') {
        cleanFields[key] = value
      } else if (typeof value === 'string') {
        cleanFields[key] = LINK_FIELD_NAMES.has(key) ? validateDestination(value) : sanitizeText(value)
      } else {
        throw new BadRequestException(`sections[${index}].fields.${key} must be a string, number, or boolean.`)
      }
    }
    return { type: type as SectionType, fields: cleanFields }
  })
}
