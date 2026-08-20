// The ONLY environments any demo/test result-forcing mechanism is ever
// honored in — shared by both the per-trade requestedResultMode (Part 26)
// and the platform-wide admin sandboxOutcomeMode dial (Trade Experience
// checkpoint, Part 8), so the two mechanisms can never drift apart. Hard-
// coded — never read from the database, never overridable by any request
// field or admin toggle. Staging is deliberately EXCLUDED, matching
// execution-provider.factory.ts's fail-closed posture for the ambiguous case.
export const DEMO_RESULT_MODE_ALLOWED_ENVS = new Set(['development', 'test'])

export function isDemoResultModeAllowed(): boolean {
  return DEMO_RESULT_MODE_ALLOWED_ENVS.has(process.env.NODE_ENV ?? 'development')
}
