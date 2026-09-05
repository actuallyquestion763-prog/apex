// Backend rejection/error messages sometimes carry an internal code prefix,
// e.g. "RISK_CONFIGURATION_ERROR: No trusted price is available to evaluate
// this order." — that code is an implementation detail and must never reach
// the UI. Ordinary messages (no code, or a colon mid-sentence) pass through
// unchanged. Requiring an underscore-joined ALL-CAPS token before the colon
// keeps this from stripping a legitimate leading word like "Note: ...".
const BACKEND_CODE_PREFIX = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+:\s+/

export function stripInternalCodePrefix(message: string): string {
  return message.replace(BACKEND_CODE_PREFIX, '')
}
