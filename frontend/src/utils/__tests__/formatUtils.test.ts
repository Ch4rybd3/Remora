import { describe, expect, it } from 'vitest'

import { defang, fmtBytes, fmtDuration } from '../formatUtils'

describe('fmtBytes', () => {
  it.each([
    [null, '—'],
    [undefined, '—'],
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 ** 2, '1.0 MB'],
    [1024 ** 3, '1.00 GB'],
  ])('formats %s as %s', (input, expected) => {
    expect(fmtBytes(input as number | null | undefined)).toBe(expected)
  })

  it('uses binary units, not decimal ones', () => {
    // 1000 bytes is not a kilobyte here — forensic sizes come from filesystems.
    expect(fmtBytes(1000)).toBe('1000 B')
  })
})

describe('fmtDuration', () => {
  it.each([
    [0, '0s'],
    [45, '45s'],
    [60, '1m'],
    [134, '2m 14s'],
    [300, '5m'],
  ])('formats %ss as %s', (input, expected) => {
    expect(fmtDuration(input)).toBe(expected)
  })
})

describe('defang', () => {
  it('neutralises the dots in an IP', () => {
    expect(defang('192.168.1.1', 'ip')).toBe('192[.]168[.]1[.]1')
  })

  it('neutralises the dots in a domain', () => {
    expect(defang('evil.example.com', 'domain')).toBe('evil[.]example[.]com')
  })

  it('neutralises the scheme and the dots in a URL', () => {
    expect(defang('http://evil.com/path', 'url')).toBe('hxxp://evil[.]com/path')
    expect(defang('https://evil.com', 'url')).toBe('hxxps://evil[.]com')
  })

  it('is case-insensitive on the scheme', () => {
    expect(defang('HTTP://evil.com', 'url')).toBe('hxxp://evil[.]com')
  })

  it('leaves other IOC types untouched', () => {
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(defang(sha256, 'hash')).toBe(sha256)
    expect(defang('user@evil.com', 'email')).toBe('user@evil.com')
  })

  it('produces output that no longer parses as a live indicator', () => {
    // The whole point of defanging: nothing in the result is clickable.
    const out = defang('http://evil.com', 'url')
    expect(out).not.toContain('http:')
    expect(out).not.toMatch(/\.[a-z]/i)
  })
})
