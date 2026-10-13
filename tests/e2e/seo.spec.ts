import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

test('link previews: Open Graph and Twitter tags, icons and manifest', async ({ page, request }) => {
  await page.goto('/')
  for (const [selector, attr] of [
    ['meta[property="og:title"]', 'content'],
    ['meta[property="og:description"]', 'content'],
    ['meta[property="og:image"]', 'content'],
    ['meta[property="og:image:alt"]', 'content'],
    ['meta[name="twitter:card"]', 'content'],
    ['link[rel="apple-touch-icon"]', 'href'],
    ['link[rel="manifest"]', 'href'],
  ] as const) {
    await expect(page.locator(selector), selector).toHaveAttribute(attr, /.+/)
  }
  const image = await page.locator('meta[property="og:image"]').getAttribute('content')
  expect(image).toMatch(/\/og\.jpg$/)
  for (const path of ['/og.jpg', '/apple-touch-icon.png', '/favicon-32.png', '/site.webmanifest', '/robots.txt']) {
    expect((await request.get(path)).status(), path).toBe(200)
  }
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /api/')
})

test('without JavaScript the page still says what Verapass is', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/')
  const summary = page.locator('main.noscript')
  await expect(summary.locator('h1')).toHaveText('Real people. Real places. Proven.')
  await expect(summary).toContainText('licensed Tourism Authority of Thailand guide')
  await expect(summary.getByRole('link', { name: 'sukanyathaiguide@gmail.com' })).toBeVisible()
  await context.close()
})

test('the built bundle carries no hidden place names, coordinates or tips', () => {
  const dir = 'dist/assets'
  const code = readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
  // The hidden places' details live in server/places.ts only.
  const server = readFileSync('server/places.ts', 'utf8')
  const secrets = [...server.matchAll(/(?:name|tip): '([^']+)'|(?:lat|lng): ([\d.]+)/g)].map((m) => m[1] ?? m[2] ?? '')
  expect(secrets.length).toBeGreaterThanOrEqual(12)
  for (const secret of secrets) expect(code, secret).not.toContain(secret)
})
