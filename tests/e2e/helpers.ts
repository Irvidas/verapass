import { createRequire } from 'node:module'
import { expect, type Locator, type Page } from '@playwright/test'

/** Collects console errors and uncaught page errors for the whole test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

/** Opens the home page and waits until the hero intro has started (the page is no longer held back). */
export async function openHome(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await expect(page.locator('#hero-title')).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)intro(\s|$)/, { timeout: 5_000 })
}

/** Scrolls the whole page in steps so scroll animations run. */
export async function scrollThrough(page: Page): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const done = await page.evaluate(() => {
      window.scrollBy(0, Math.round(window.innerHeight * 0.8))
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
    })
    await page.waitForTimeout(120)
    if (done) break
  }
  await page.waitForTimeout(400)
}

/**
 * Clicks something below the fold the way a person would: scroll to it, let its entrance
 * animation finish, then click. (Clicking while a block is still sliding in can miss it.)
 */
export async function clickSettled(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  await target.page().waitForTimeout(1200)
  await target.click()
}

/** Picks a place from the accessible place list (the map pins are a pointer-only shortcut). */
export function placeButton(page: Page, name: string) {
  return page.getByRole('list', { name: 'All places' }).getByRole('button', { name, exact: true })
}

const requireFrom = createRequire(import.meta.url)

/** Runs axe-core in the page and returns serious and critical violations. */
export async function seriousA11yViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: requireFrom.resolve('axe-core/axe.min.js') })
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[] }> } }).axe
    const { violations } = await axe.run(document, { resultTypes: ['violations'] })
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => JSON.stringify(n.target)).join(', ')}`)
  })
}
