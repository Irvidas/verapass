import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isAppRoute, normalisePath } from '../../shared/routes'
import { createApp } from '../../server/app'
import { MockAttestor } from '../../server/attestor'
import { createReceiptSigner } from '../../server/receipts'
import { mountStatic } from '../../server/static'

const dir = mkdtempSync(join(tmpdir(), 'verapass-dist-'))
mkdirSync(join(dir, 'assets'))
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Verapass</title>')
writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
writeFileSync(join(dir, 'robots.txt'), 'User-agent: *')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

function app() {
  const a = createApp({ publicOrigin: 'http://localhost:5173', attestor: new MockAttestor(), signer: createReceiptSigner(), allowSimulated: true })
  // serveStatic resolves its root against the working directory.
  mountStatic(a, relative(process.cwd(), dir))
  return a
}

describe('serving the built app', () => {
  it('answers 200 for the pages the app has, and serves files', async () => {
    const a = app()
    for (const path of ['/', '/success', '/cancel', '/verify', '/verify/']) {
      expect((await a.request(path)).status, path).toBe(200)
    }
    expect(await (await a.request('/assets/app.js')).text()).toBe('console.log(1)')
    expect((await a.request('/robots.txt')).status).toBe(200)
  })

  it('answers 404 (with the app page, which says "not found") for anything else', async () => {
    const res = await app().request('/nope')
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('<title>Verapass</title>')
  })

  it('still routes the API first', async () => {
    expect((await app().request('/api/health')).status).toBe(200)
  })
})

describe('app routes', () => {
  it('normalises trailing slashes and knows its pages', () => {
    expect(normalisePath('')).toBe('/')
    expect(normalisePath('/verify///')).toBe('/verify')
    expect(isAppRoute('/success/')).toBe(true)
    expect(isAppRoute('/admin')).toBe(false)
  })
})
