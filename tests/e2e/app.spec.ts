import { expect, test } from '@playwright/test'
import { clickSettled, openHome, placeButton, scrollThrough, watchErrors } from './helpers'

test.describe('Verapass home page', () => {
  test('loads every section with no console errors', async ({ page }) => {
    const errors = watchErrors(page)
    await openHome(page)
    await expect(page.locator('#hero-title')).toContainText('Real people')
    await scrollThrough(page)
    for (const id of ['problem', 'sukanya', 'values', 'how', 'map', 'passport', 'places', 'pricing', 'guides', 'market', 'services', 'faq']) {
      await expect(page.locator(`section#${id}`), id).toHaveCount(1)
    }
    await expect(page.locator('section#map h2')).toHaveText('Visit. Check in. Collect.')
    await expect(page.locator('.evidence .source').first()).toHaveAttribute('href', /^https:\/\//)
    expect(errors).toEqual([])
  })

  test('shows a real photo of Sukanya and no placeholder or to-do text', async ({ page }) => {
    await openHome(page)
    await expect(page.locator('#sukanya .meet-portrait img')).toHaveAttribute('alt', /Sukanya/)
    await expect(page.locator('body')).not.toContainText('Founders to add')
    await expect(page.locator('body')).not.toContainText('Placeholder')
    await expect(page.locator('[role="img"][aria-label^="Placeholder"]')).toHaveCount(0)
  })

  test('the demo check-in adds a verified stamp to the passport, and it survives a reload', async ({ page }) => {
    const errors = watchErrors(page)
    await openHome(page)
    await expect(page.getByTestId('dock-count')).toHaveText('0/10')

    await placeButton(page, 'Wat Chalong').click()
    await expect(page.getByTestId('selected-place')).toHaveText('Wat Chalong')
    await page.getByRole('button', { name: 'Demo: simulate being here' }).click()

    await expect(page.locator('#map .status-ok')).toContainText('Demo stamp collected at Wat Chalong')
    // The stamp flies into the dock, and the dock counter waits for it to land.
    await expect(page.locator('.flying-stamp')).toBeVisible()
    await expect(page.getByTestId('dock-count')).toHaveText('0/10')
    await expect(page.locator('.flying-stamp')).toHaveCount(0)
    await expect(page.getByTestId('dock-count')).toHaveText('1/10')
    await expect(page.getByTestId('passport-count')).toHaveText('1')
    const slot = page.locator('[data-slot="wat-chalong"]')
    await expect(slot).toHaveClass(/is-filled/)
    await expect(slot).toContainText('Simulated visit')
    await expect(slot.locator('code')).toHaveText(/^mock-[0-9a-f]{16}$/)
    // The signature and proof hash are checked in the browser against the server's published key.
    await expect(slot).toContainText('Signature verified in your browser')
    await expect(placeButton(page, 'Wat Chalong, collected')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('dock-count')).toHaveText('1/10')
    await expect(page.locator('[data-slot="wat-chalong"]')).toHaveClass(/is-filled/)
    await expect(page.locator('[data-slot="wat-chalong"]')).toContainText('Signature verified in your browser')
    expect(errors).toEqual([])
  })

  test('a stamp edited in localStorage is flagged and does not count', async ({ page }) => {
    await openHome(page)
    await page.getByRole('button', { name: 'Demo: simulate being here' }).click()
    await expect(page.getByTestId('dock-count')).toHaveText('1/10', { timeout: 10_000 })
    await page.evaluate(() => {
      const key = 'verapass:passport:v2'
      const data = JSON.parse(localStorage.getItem(key) ?? '{}')
      // Claim it was a real visit, not a simulated one.
      data.stamps[0].simulated = false
      data.stamps[0].receipt.simulated = false
      localStorage.setItem(key, JSON.stringify(data))
    })
    await page.reload()
    const slot = page.locator('[data-slot="patong-beach"]')
    await expect(slot).toContainText('Does not verify: edited or forged')
    await expect(slot).toHaveClass(/is-unverified/)
    await expect(page.getByTestId('dock-count')).toHaveText('0/10')
  })

  test('a new stamp carries a pseudonym, and an older stamp with the raw traveller id gets no share link', async ({ page }) => {
    await openHome(page)
    await page.getByRole('button', { name: 'Demo: simulate being here' }).click()
    await expect(page.getByTestId('dock-count')).toHaveText('1/10', { timeout: 10_000 })
    const slot = page.locator('[data-slot="patong-beach"]')
    await expect(slot.getByRole('link', { name: 'Check this stamp' })).toHaveCount(1)
    const traveller = await page.evaluate(() => {
      const key = 'verapass:passport:v2'
      const data = JSON.parse(localStorage.getItem(key) ?? '{}')
      const before = data.stamps[0].receipt.traveller as string
      // What a stamp made before 2026-10-10 looked like: the id itself in the receipt and preimage.
      data.stamps[0].receipt.traveller = data.traveller
      data.stamps[0].proof.traveller = data.traveller
      localStorage.setItem(key, JSON.stringify(data))
      return { before, id: data.traveller as string }
    })
    expect(traveller.before).toMatch(/^anon_[0-9a-f]{32}$/)
    expect(traveller.id).toMatch(/^trav_/)
    await page.reload()
    await expect(slot).toContainText('it holds your passport id, so it has no link to share')
    await expect(slot.getByRole('link', { name: 'Check this stamp' })).toHaveCount(0)
    const hrefs = await page.locator('a[href*="#stamp="]').evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''))
    expect(hrefs).toEqual([])
  })

  test('a real GPS check-in from far away is refused by the server', async ({ page, context }) => {
    const errors = watchErrors(page)
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 54.6872, longitude: 25.2797, accuracy: 10 })
    await openHome(page)
    await page.getByRole('button', { name: 'Check in with my GPS' }).click()
    await expect(page.locator('#map .status-error')).toContainText('Not yet: you are')
    await expect(page.getByTestId('dock-count')).toHaveText('0/10')
    // The 422 shows up as a failed resource load in the console; that one is expected.
    expect(errors.filter((e) => !e.includes('422'))).toEqual([])
  })

  test('a real GPS check-in at the place collects a real (not simulated) stamp', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 7.8961, longitude: 98.296, accuracy: 8 })
    await openHome(page)
    await expect(page.getByTestId('selected-place')).toHaveText('Patong Beach')
    await page.getByRole('button', { name: 'Check in with my GPS' }).click()
    await expect(page.locator('#map .status-ok')).toContainText('Stamp collected at Patong Beach')
    const slot = page.locator('[data-slot="patong-beach"]')
    await expect(slot).toHaveClass(/is-filled/)
    await expect(slot).not.toContainText('Simulated visit')
  })

  test('checkout reaches the demo success page and unlocks the hidden places', async ({ page }) => {
    const errors = watchErrors(page)
    await openHome(page)
    await expect(page.getByTestId('place-card-secret-reef')).toHaveClass(/locked/)
    await expect(placeButton(page, 'Hidden reef, locked')).toBeVisible()
    await clickSettled(page.getByRole('button', { name: /^Get the Phuket pass, \$19$/ }))

    await expect(page).toHaveURL(/\/success\?session_id=demo_[0-9a-f]{16}$/)
    await expect(page.getByTestId('success-title')).toHaveText('Your Phuket pass is active.')
    await expect(page.getByText('Demo mode - no payment was taken')).toBeVisible()

    await page.getByRole('link', { name: 'Open the map' }).click()
    await expect(page).toHaveURL(/\/#map$/)
    await expect(page.locator('#map-title')).toBeInViewport()
    await expect(page.getByTestId('place-card-secret-reef')).not.toHaveClass(/locked/)
    await expect(placeButton(page, 'Secret reef')).toBeVisible()
    await expect(page.getByText('Your pass is active (demo)')).toBeVisible()

    // The unlocked hidden place can be collected.
    await placeButton(page, 'Secret reef').click()
    await page.getByRole('button', { name: 'Demo: simulate being here' }).click()
    await expect(page.locator('#map .status-ok')).toContainText('Demo stamp collected at Secret reef')
    expect(errors).toEqual([])
  })

  test('a pass flag edited in localStorage unlocks nothing', async ({ page }) => {
    await openHome(page)
    await page.evaluate(() => {
      localStorage.setItem(
        'verapass:passport:v2',
        JSON.stringify({ version: 2, traveller: null, stamps: [], pass: { unlocked: true, sessionId: 'demo_0000000000000000', demo: true } }),
      )
    })
    await page.reload()
    await expect(placeButton(page, 'Hidden reef, locked')).toBeVisible()
    await expect(page.getByTestId('place-card-secret-reef')).toHaveClass(/locked/)
    await expect(page.locator('#passport')).toContainText('hidden places locked')
  })

  test('the success link does not unlock the pass for another browser', async ({ page, browser }) => {
    await openHome(page)
    await clickSettled(page.getByRole('button', { name: /^Get the Phuket pass, \$19$/ }))
    await expect(page.getByTestId('success-title')).toBeVisible()
    const link = page.url()

    const other = await browser.newContext()
    const friend = await other.newPage()
    await friend.goto(link)
    await expect(friend.getByRole('alert')).toContainText('bought with another passport')
    await other.close()
  })

  test('the cancel page explains that nothing was charged', async ({ page }) => {
    await page.goto('/cancel')
    await expect(page.getByRole('heading', { name: 'Checkout cancelled.' })).toBeVisible()
  })

  test('an unknown address shows a not-found page that is not indexed', async ({ page }) => {
    await page.goto('/this-place-does-not-exist')
    await expect(page.getByRole('heading', { name: 'This page is not on the map.' })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  })
})

test.describe('verify a stamp', () => {
  test('a collected stamp opens on the verify page and checks out; an edited one does not', async ({ page }) => {
    const errors = watchErrors(page)
    await openHome(page)
    await page.getByRole('button', { name: 'Demo: simulate being here' }).click()
    await expect(page.getByTestId('dock-count')).toHaveText('1/10', { timeout: 10_000 })
    await clickSettled(page.locator('[data-slot="patong-beach"]').getByRole('link', { name: 'Check this stamp' }))

    await expect(page).toHaveURL(/\/verify#stamp=/)
    await expect(page.getByRole('heading', { name: 'This stamp checks out.' })).toBeVisible()
    await expect(page.locator('.verify-report')).toContainText('Pass: It was signed by the Verapass server key')
    await expect(page.locator('.verify-report')).toContainText('simulated (demo) visit')

    const json = await page.locator('#stamp-json').inputValue()
    await page.locator('#stamp-json').fill(json.replace('"placeId": "patong-beach"', '"placeId": "wat-chalong"'))
    await page.getByRole('button', { name: 'Check it' }).click()
    await expect(page.getByRole('heading', { name: 'This stamp does not check out.' })).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })

  test('has no horizontal overflow anywhere on the page', async ({ page }) => {
    const errors = watchErrors(page)
    await openHome(page)
    const overflow = async () =>
      page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.documentElement.clientWidth,
      }))
    expect(await overflow()).toEqual({ doc: 0, body: 0 })
    await scrollThrough(page)
    expect(await overflow()).toEqual({ doc: 0, body: 0 })
    expect(errors).toEqual([])
  })

  test('opens on the verify card, which fits the first screen above the headline', async ({ page }) => {
    await openHome(page)
    const card = await page.locator('.verify-card').boundingBox()
    const title = await page.locator('#hero-title').boundingBox()
    expect(card && title).toBeTruthy()
    if (!card || !title) return
    expect(card.y + card.height).toBeLessThanOrEqual(812 * 0.75)
    expect(card.y).toBeLessThan(title.y)
    await expect(page.locator('.verify-caption')).toContainText('Real person', { timeout: 8_000 })
  })

  test('the passport dock is a small badge that keeps its full accessible name', async ({ page }) => {
    await openHome(page)
    const dock = page.locator('#passport-dock')
    const box = await dock.boundingBox()
    expect(box?.width).toBeLessThanOrEqual(56)
    // The dock steps aside (visibility: hidden) while the hero is on screen, which also takes it out of
    // the accessibility tree. Check its name where it is shown, past the hero.
    await page.locator('section#problem').scrollIntoViewIfNeeded()
    await expect(dock).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Your passport' }).getByRole('link')).toHaveAccessibleName(/Passport 0\/10\s+places collected/)
  })
})

test.describe('prefers-reduced-motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('renders all content at once, without smooth scroll or custom cursor', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/')
    await expect(page.locator('html')).not.toHaveClass(/intro/)
    await expect(page.locator('#hero-title')).toBeVisible()
    await expect(page.locator('.verify-caption')).toContainText('Real person')
    await expect(page.locator('html')).not.toHaveClass(/lenis|has-cursor/)

    await scrollThrough(page)
    for (const heading of await page.locator('main h2').all()) {
      await heading.scrollIntoViewIfNeeded()
      await expect(heading).toBeVisible()
      await expect.poll(() => heading.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1)
    }
    // The check-in demo still works without motion.
    await page.getByRole('button', { name: 'Demo: simulate being here' }).click()
    await expect(page.getByTestId('dock-count')).toHaveText('1/10')
    expect(errors).toEqual([])
  })
})

test.describe('live Stellar mode', () => {
  const CONTRACT = 'CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65'

  test('a stamp minted on the contract links to its transaction on stellar.expert', async ({ page }) => {
    const errors = watchErrors(page)
    // The e2e server runs in mock mode, so the live answers are stood in for here.
    await page.route('**/api/health', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...(await response.json()), attestation: 'testnet', contractId: CONTRACT } })
    })
    const txHash = 'a0418077886bbdc9f62e313da01088c6d0e89791a313f74092a77329e43ff638'
    await page.route('**/api/checkin', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      body.attestation = {
        status: 'confirmed',
        signature: body.attestation.signature,
        record: {
          mode: 'testnet',
          network: 'stellar-testnet',
          id: 'token-7',
          txHash,
          explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txHash}`,
          contract: { id: CONTRACT, url: `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`, traveller: 'GAO3HGZE3BRO6WIBY3WQPBW4WSJ265UO6CPPJUCUD2U4FDMQRYPC7LMO', tokenId: 7 },
        },
      }
      await route.fulfill({ response, json: body })
    })

    await openHome(page)
    await expect(page.getByRole('link', { name: 'Verapass contract on Stellar testnet' })).toHaveAttribute('href', `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`)
    await page.getByRole('button', { name: 'Demo: simulate being here' }).click()
    // The record here is not signed by the server, so the stamp does not count; its links still render.
    const link = page.locator('[data-slot="patong-beach"]').getByRole('link', { name: /Stamp #7 on Stellar testnet/ })
    await expect(link).toHaveAttribute('href', `https://stellar.expert/explorer/testnet/tx/${txHash}`, { timeout: 10_000 })
    await expect(link).toHaveAttribute('target', '_blank')
    expect(errors).toEqual([])
  })
})
