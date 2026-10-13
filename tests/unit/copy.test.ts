import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|html)$/.test(name) ? [path] : []
  })
}

const SOURCES = [...files('src'), ...files('shared'), 'index.html']
const BANNED = ['delve', 'leverage', 'robust', 'seamless', 'crucial', 'pivotal', 'landscape', 'realm', 'foster', 'testament', 'tapestry', 'boasts', 'underscore']

describe('site copy', () => {
  it('is plain printable ASCII (the self-hosted fonts are ASCII subsets, and the house style asks for it)', () => {
    const offenders = SOURCES.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /[^\x20-\x7E\t]/.test(line))
        .map(({ i }) => `${f}:${i + 1}`),
    )
    expect(offenders).toEqual([])
  })

  it('avoids filler words', () => {
    const offenders = SOURCES.flatMap((f) => {
      const text = readFileSync(f, 'utf8').toLowerCase()
      return BANNED.filter((w) => new RegExp(`\\b${w}`).test(text)).map((w) => `${f}: ${w}`)
    })
    expect(offenders).toEqual([])
  })
})
