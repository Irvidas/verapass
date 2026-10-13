import { expect, test, type Page } from '@playwright/test'
import { openHome, scrollThrough, seriousA11yViolations } from './helpers'

/**
 * Accessibility gate: no serious or critical axe violations at desktop and phone widths, with
 * and without motion, and a keyboard walk where every focused element is actually visible.
 */
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`axe: no serious violations at ${viewport.width}px, motion ${reducedMotion}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, reducedMotion })
      const page = await context.newPage()
      await openHome(page)
      await scrollThrough(page)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(600)
      expect(await seriousA11yViolations(page)).toEqual([])
      await context.close()
    })
  }
}

test('axe: the verify, success and not-found pages', async ({ page }) => {
  for (const path of ['/verify', '/cancel', '/nope']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    expect(await seriousA11yViolations(page), path).toEqual([])
  }
})

/** Where the focused element is, and whether a person can see it. */
async function focusState(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const r = el.getBoundingClientRect()
    let opacity = 1
    for (let n: HTMLElement | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity)
    const cx = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2))
    const cy = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2))
    const hit = document.elementFromPoint(cx, cy)
    return {
      label: `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`,
      inViewport: r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth,
      opacity,
      covered: Boolean(hit && hit !== el && !el.contains(hit) && !hit.contains(el)),
      coveredBy: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className)}` : '',
    }
  })
}

test('keyboard: every focus stop is on screen, visible and not covered', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openHome(page)
  await page.waitForTimeout(3500)
  const problems: string[] = []
  let stops = 0
  for (let i = 0; i < 160; i++) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(140)
    let state = await focusState(page)
    if (!state) break
    // Give smooth scrolling and scrubbed animations a moment to settle before judging.
    if (!state.inViewport || state.opacity < 0.9 || state.covered) {
      await page.waitForTimeout(900)
      state = await focusState(page)
      if (!state) break
    }
    stops += 1
    if (!state.inViewport) problems.push(`${i}: ${state.label} is off screen`)
    if (state.opacity < 0.9) problems.push(`${i}: ${state.label} has opacity ${state.opacity.toFixed(2)}`)
    if (state.covered) problems.push(`${i}: ${state.label} is covered by ${state.coveredBy}`)
    if (state.label.includes('Check a stamp') && i > 40) break
  }
  expect(stops).toBeGreaterThan(30)
  expect(problems).toEqual([])
})

test('keyboard: the evidence row does not scroll sideways on its own', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openHome(page)
  const last = page.locator('.evidence .source').last()
  await last.focus()
  await page.waitForTimeout(1200)
  expect(await page.locator('.track').evaluate((t) => t.scrollLeft)).toBe(0)
  const box = await last.boundingBox()
  expect(box && box.x >= 0 && box.x + box.width <= 1440).toBe(true)
  expect(await last.evaluate((el) => Number(getComputedStyle(el.closest('.evidence') as Element).opacity))).toBeGreaterThan(0.9)
})

test.describe('mobile menu', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps focus inside while open and stops the page from scrolling behind it', async ({ page }) => {
    await openHome(page)
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.locator('#mobile-menu')).toBeVisible()
    await expect(page.locator('#main')).toHaveJSProperty('inert', true)
    const before = await page.evaluate(() => window.scrollY)
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      const insideHeader = await page.evaluate(() => Boolean(document.activeElement?.closest('header')))
      expect(insideHeader, `tab ${i}`).toBe(true)
    }
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
    await page.keyboard.press('Escape')
    await expect(page.locator('#mobile-menu')).toBeHidden()
    await expect(page.locator('#main')).toHaveJSProperty('inert', false)
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused()
  })

  test('a menu link closes the menu and scrolls to its section', async ({ page }) => {
    await openHome(page)
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.locator('#mobile-menu').getByRole('link', { name: 'Try a check-in' }).click()
    await expect(page.locator('#mobile-menu')).toBeHidden()
    await expect(page.locator('#map-title')).toBeInViewport({ timeout: 5_000 })
  })
})

test('print and save as PDF show every block of text', async ({ page }) => {
  await openHome(page)
  await page.emulateMedia({ media: 'print' })
  const hidden = await page.evaluate(() =>
    Array.from(document.querySelectorAll('main h2, main h3, main p'))
      .filter((el) => {
        let opacity = 1
        for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity)
        const hiddenNow = opacity < 0.9 || getComputedStyle(el).visibility === 'hidden'
        return hiddenNow && el.closest('[aria-hidden="true"]') === null
      })
      .map((el) => el.textContent?.slice(0, 40)),
  )
  expect(hidden).toEqual([])
})
