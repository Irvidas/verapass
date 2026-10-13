export interface Product {
  id: string
  name: string
  description: string
  /** Amount in the currency's minor unit (cents). */
  amount: number
  currency: string
}

/**
 * The Phuket pass: Sukanya's eBook + the full map + the proof-of-presence passport.
 * $19 is the launch price from the original landing page; the founders still have to confirm it.
 */
export const PHUKET_PASS: Product = {
  id: 'phuket-pass',
  name: 'Phuket pass',
  description: "Sukanya's eBook 'Phuket Without the Tourist Traps', every hidden place on the map, and your proof-of-presence passport.",
  amount: 1900,
  currency: 'usd',
}

const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

/** Formats a Stripe-style minor-unit amount, e.g. formatPrice(1900, 'usd') -> "$19". */
export function formatPrice(amountMinor: number, currency: string, locale = 'en-US'): string {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) throw new RangeError('amount must be a non-negative integer')
  const code = currency.toLowerCase()
  const major = ZERO_DECIMAL.has(code) ? amountMinor : amountMinor / 100
  const whole = Number.isInteger(major)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(major)
}
