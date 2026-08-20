// List views only ever show a masked ID number (Part 23) — the full value
// is returned exclusively from the single-submission admin detail endpoint,
// to an already-permission-checked reviewer.
export function maskIdNumber(idNumber: string | null): string | null {
  if (!idNumber) return idNumber
  const visible = Math.min(4, idNumber.length)
  return '•'.repeat(idNumber.length - visible) + idNumber.slice(idNumber.length - visible)
}
