import { randomInt } from 'crypto'

// Excludes visually-ambiguous characters (0/O, 1/I/L) — this code is meant
// to be read aloud/typed by a real person, not just displayed.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateReferralCode(length = 8): string {
  let code = ''
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}
