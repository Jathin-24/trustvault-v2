import { describe, expect, it } from 'vitest'
import { ALLOWED, MAX_SIZE_BYTES, sanitizeName, sniffMime, validateUpload } from '@/lib/upload'

const bytes = (...b: number[]) => new Uint8Array(b)
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x34, 0x2e, 0x34)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0)
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04)
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00)
const TEXT = new TextEncoder().encode('hello, plain text\n')
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50)

describe('sanitizeName — path traversal + control characters (M9)', () => {
  it('strips directories from a traversal payload', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeName('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe')
    expect(sanitizeName('/absolute/path/doc.pdf')).toBe('doc.pdf')
  })

  it('removes NUL and other control characters', () => {
    expect(sanitizeName('evil\u0000\u001f\u007f.pdf')).toBe('evil.pdf')
  })

  it('trims whitespace and caps length at 255', () => {
    expect(sanitizeName('  report.pdf  ')).toBe('report.pdf')
    expect(sanitizeName('x'.repeat(300)).length).toBe(255)
  })
})

describe('sniffMime — real content, never the declared type (M5)', () => {
  it.each([
    ['%PDF header', PDF, 'application/pdf'],
    ['PNG header', PNG, 'image/png'],
    ['JPEG header', JPG, 'image/jpeg'],
    ['GIF header', GIF, 'image/gif'],
    ['ZIP header', ZIP, 'application/zip'],
    ['RIFF header', WEBP, 'image/webp'],
    ['valid utf-8 text', TEXT, 'text'],
  ])('%s', (_label, input, expected) => {
    expect(sniffMime(input)).toBe(expected)
  })

  it('rejects an exe (MZ) regardless of any filename', () => {
    expect(sniffMime(EXE)).toBeNull()
  })

  it('rejects binary junk without NULs that is not valid utf-8', () => {
    // regression: fatal decode failure used to fall through (PROMPTS #4)
    expect(sniffMime(bytes(0xc3, 0x28, 0xa0, 0xa1))).toBeNull()
  })

  it('rejects content containing NUL bytes', () => {
    expect(sniffMime(bytes(0x68, 0x69, 0x00, 0x21))).toBeNull()
  })
})

describe('validateUpload — M4/M5/M9 upload gates', () => {
  const ok = {
    declaredName: 'contract.pdf',
    declaredMime: 'application/pdf',
    size: 1024,
    head: PDF,
  }

  it('accepts a genuine pdf', () => {
    expect(validateUpload(ok)).toBeNull()
  })

  it('accepts png/gif/zip/webp with matching names', () => {
    expect(validateUpload({ declaredName: 'shot.png', declaredMime: 'image/png', size: 10, head: PNG })).toBeNull()
    expect(validateUpload({ declaredName: 'anim.gif', declaredMime: 'image/gif', size: 10, head: GIF })).toBeNull()
    expect(validateUpload({ declaredName: 'pack.zip', declaredMime: 'application/zip', size: 10, head: ZIP })).toBeNull()
    expect(validateUpload({ declaredName: 'img.webp', declaredMime: 'image/webp', size: 10, head: WEBP })).toBeNull()
  })

  it('accepts txt/csv only when the content is text', () => {
    expect(validateUpload({ declaredName: 'notes.txt', declaredMime: 'text/plain', size: 20, head: TEXT })).toBeNull()
    expect(validateUpload({ declaredName: 'rows.csv', declaredMime: 'text/csv', size: 20, head: TEXT })).toBeNull()
  })

  it('rejects an exe renamed .pdf — unrecognized content', () => {
    expect(
      validateUpload({ declaredName: 'invoice.pdf', declaredMime: 'application/pdf', size: 100, head: EXE }),
    ).toBe('unrecognized file content')
  })

  it('enforces the 4 MB cap (D4) and rejects empty files', () => {
    expect(validateUpload({ ...ok, size: MAX_SIZE_BYTES + 1 })).toBe('file exceeds 4 MB')
    expect(validateUpload({ ...ok, size: 0 })).toBe('empty file')
    expect(validateUpload({ ...ok, size: MAX_SIZE_BYTES })).toBeNull()
  })

  it('rejects extensions outside the allowlist', () => {
    expect(validateUpload({ ...ok, declaredName: 'run.exe' })).toBe('file type not allowed')
    expect(validateUpload({ ...ok, declaredName: 'noext' })).toBe('file type not allowed')
  })

  it('sanitises a traversal name before judging it', () => {
    expect(validateUpload({ ...ok, declaredName: '../../../etc/passwd.pdf' })).toBeNull()
    expect(sanitizeName('../../../etc/passwd.pdf')).toBe('passwd.pdf')
  })

  it('rejects real pdf bytes hiding behind a .txt name', () => {
    expect(validateUpload({ ...ok, declaredName: 'readme.txt', declaredMime: 'text/plain' })).toBe(
      'file extension does not match content',
    )
  })

  it('rejects text bytes claiming to be an image', () => {
    expect(
      validateUpload({ declaredName: 'pic.png', declaredMime: 'image/png', size: 20, head: TEXT }),
    ).toBe('file type not allowed')
  })

  it('rejects a declared mime that disagrees with the content', () => {
    expect(validateUpload({ ...ok, declaredMime: 'image/png' })).toBe('declared type does not match content')
    expect(
      validateUpload({ declaredName: 'notes.txt', declaredMime: 'application/pdf', size: 20, head: TEXT }),
    ).toBe('declared type does not match content')
  })

  it('does not trust an empty declared mime to pass anything through', () => {
    expect(validateUpload({ ...ok, declaredMime: '' })).toBeNull() // pdf bytes + .pdf name stand alone
    expect(validateUpload({ declaredName: 'x.exe', declaredMime: '', size: 1, head: PDF })).toBe(
      'file type not allowed',
    )
  })
})

describe('allowlist shape', () => {
  it('covers only the eight documented types', () => {
    expect(Object.keys(ALLOWED)).toHaveLength(8)
    expect(Object.values(ALLOWED).flatMap((v) => v.ext)).toContain('pdf')
  })
})
