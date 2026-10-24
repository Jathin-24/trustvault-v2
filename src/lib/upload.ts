import 'server-only'

export const MAX_SIZE_BYTES = 4194304 // 4 MB (D4)

// Extension allowlist. The real type is confirmed from magic bytes,
// never from the browser's claim.
export const ALLOWED: Record<string, { mime: string; ext: string[] }> = {
  'application/pdf': { mime: 'application/pdf', ext: ['pdf'] },
  'image/png': { mime: 'image/png', ext: ['png'] },
  'image/jpeg': { mime: 'image/jpeg', ext: ['jpg', 'jpeg'] },
  'image/gif': { mime: 'image/gif', ext: ['gif'] },
  'image/webp': { mime: 'image/webp', ext: ['webp'] },
  'text/plain': { mime: 'text/plain', ext: ['txt'] },
  'text/csv': { mime: 'text/csv', ext: ['csv'] },
  'application/zip': { mime: 'application/zip', ext: ['zip'] },
}

/** Strip directories, control chars and path separators from a filename. */
export function sanitizeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'file'
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
}

/**
 * Detect the real type from the file's leading bytes (magic bytes).
 * A .exe renamed to .pdf fails here: its header doesn't match PDF.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) =>
    sig.every((b, i) => bytes[i] === b)

  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf' // %PDF
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png' // \x89PNG
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg' // \xFF\xD8\xFF
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif' // GIF8
  if (startsWith(0x50, 0x4b)) return 'application/zip' // PK.. (also docx etc.)
  if (startsWith(0x52, 0x49, 0x46, 0x46)) return 'image/webp' // RIFF....WEBP

  // Text formats have no magic bytes. Accept when the head looks like
  // text (no NUL bytes); the fatal-decode guard rejects binary junk
  // that happens to lack NULs. Truncation mid-codepoint is tolerated
  // by retrying without fatal mode.
  if (looksLikeText(bytes)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return 'text'
    } catch {
      try {
        new TextDecoder('utf-8').decode(bytes)
        return 'text'
      } catch {
        return null
      }
    }
  }
  return null
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 1024)
  if (sample.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/** Returns an error string, or null if the file passes. */
export function validateUpload(opts: {
  declaredName: string
  declaredMime: string
  size: number
  head: Uint8Array
}): string | null {
  const { declaredName, declaredMime, size, head } = opts

  if (size <= 0) return 'empty file'
  if (size > MAX_SIZE_BYTES) return 'file exceeds 4 MB'

  const name = sanitizeName(declaredName)
  if (!name || name.length > 255) return 'invalid file name'

  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const allowedExts = new Set(Object.values(ALLOWED).flatMap((v) => v.ext))
  if (!allowedExts.has(ext)) return 'file type not allowed'

  const sniffed = sniffMime(head)
  if (!sniffed || sniffed === 'text') {
    if (!sniffed) return 'unrecognized file content'
    // text: the extension (txt/csv) is the discriminator, since
    // sniffing can't tell plain from csv.
    if (!['txt', 'csv'].includes(ext)) return 'file type not allowed'
    if (declaredMime && !declaredMime.startsWith('text/')) {
      return 'declared type does not match content'
    }
    return null
  }
  if (!ALLOWED[sniffed]) return 'file type not allowed'

  // The extension must agree with the real content AND the declared
  // mime. A PDF header on a .txt name is still rejected.
  const allowedForSniffed = ALLOWED[sniffed].ext
  if (!allowedForSniffed.includes(ext)) {
    return 'file extension does not match content'
  }
  if (declaredMime && declaredMime.split(';')[0].trim() !== sniffed) {
    return 'declared type does not match content'
  }

  return null
}
