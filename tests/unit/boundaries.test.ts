import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('module boundaries', () => {
  it('the web app never imports server code, so hidden place details cannot reach the bundle', () => {
    const offenders = files('src').filter((f) => /from ['"][./]*server\//.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('shared code never imports server or app code', () => {
    const offenders = files('shared').filter((f) => /from ['"]\.\.\/(server|src)\//.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
