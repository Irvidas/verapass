import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

// Dedicated ports, so the e2e run never reuses a dev server that might have Stripe keys set.
const API_PORT = '8797'
const WEB_PORT = '4179'

// Stable keys for this run, so the server starts without "no key" warnings and stamps verify across reloads.
const receiptKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString().replace(/\n/g, '\\n')

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Demo mode on purpose: empty Stripe and Stellar keys override anything in .env.
      // Rate limits are raised: every test asks for its own traveller id from the same address.
      command: 'npx tsx server/index.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        PORT: API_PORT,
        STRIPE_SECRET_KEY: '',
        STRIPE_WEBHOOK_SECRET: '',
        STELLAR_SECRET: '',
        // State in memory: never touch a shared Redis store a local .env might point to.
        VERAPASS_REDIS_REST_URL: '',
        VERAPASS_REDIS_REST_TOKEN: '',
        UPSTASH_REDIS_REST_URL: '',
        UPSTASH_REDIS_REST_TOKEN: '',
        KV_REST_API_URL: '',
        KV_REST_API_TOKEN: '',
        ALLOW_SIMULATED_CHECKINS: 'true',
        PUBLIC_ORIGIN: `http://localhost:${WEB_PORT}`,
        RECEIPT_SIGNING_KEY: receiptKey,
        TRAVELLER_SECRET: randomBytes(24).toString('hex'),
        RATE_LIMIT_TRAVELLER_PER_HOUR: '10000',
        RATE_LIMIT_API_PER_MINUTE: '10000',
        RATE_LIMIT_PLACE_PER_MINUTE: '10000',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PORT },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
