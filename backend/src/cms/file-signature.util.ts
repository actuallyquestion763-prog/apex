// Magic-byte (file signature) verification (Phase 4, Part 10). Previously
// this backend trusted only the client-declared MIME type, which a caller
// can freely lie about (rename a script to photo.png and claim image/png).
// This checks the actual leading bytes of the uploaded buffer against the
// known signature for each currently-supported format — not a full format
// parser (it doesn't guarantee the rest of the file is well-formed), just a
// real check that closes the specific gap of a mislabeled upload.

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIG = [0xff, 0xd8, 0xff]
const GIF_SIG = [0x47, 0x49, 0x46, 0x38] // "GIF8" (covers both GIF87a and GIF89a)
const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46] // "RIFF"

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false
  return bytes.every((b, i) => buffer[i] === b)
}

// Formats with a real, checkable magic-byte signature. SVG is deliberately
// absent — it's XML text with no fixed byte signature, and (more
// importantly) can carry active content (<script>, event handlers,
// foreignObject) that a byte-signature check wouldn't address anyway. See
// media-storage.service.ts: SVG is not in the allowlist at all in this
// phase, restricted rather than half-sanitized, per the explicit either/or
// in the Phase 4 spec (Part 10) — there is no vetted SVG sanitizer
// dependency in this project, and adding one is a bigger decision than this
// phase's proportionate scope.
export function matchesFileSignature(mimeType: string, buffer: Buffer): boolean {
  switch (mimeType) {
    case 'image/png':
      return startsWith(buffer, PNG_SIG)
    case 'image/jpeg':
      return startsWith(buffer, JPEG_SIG)
    case 'image/gif':
      return startsWith(buffer, GIF_SIG)
    case 'image/webp':
      // RIFF <4-byte size> WEBP — "RIFF" at offset 0, "WEBP" at offset 8.
      return buffer.length >= 12 && startsWith(buffer, RIFF_SIG) && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    case 'application/pdf':
      return startsWith(buffer, PDF_SIG)
    default:
      return false
  }
}
