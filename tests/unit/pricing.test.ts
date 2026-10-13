import { describe, expect, it } from 'vitest'
import { formatPrice, PHUKET_PASS } from '../../shared/pricing'

describe('formatPrice', () => {
  it('formats whole dollar amounts without decimals', () => {
    expect(formatPrice(1900, 'usd')).toBe('$19')
    expect(formatPrice(0, 'usd')).toBe('$0')
  })

  it('keeps two decimals when there are cents', () => {
    expect(formatPrice(1999, 'usd')).toBe('$19.99')
    expect(formatPrice(1905, 'USD')).toBe('$19.05')
  })

  it('handles zero-decimal currencies', () => {
    expect(formatPrice(1900, 'jpy')).toBe('¥1,900')
  })

  it('formats other currencies and locales', () => {
    // Intl puts a no-break space between a currency code and the amount.
    expect(formatPrice(65000, 'thb', 'en-US').replace(/\s/g, ' ')).toBe('THB 650')
    expect(formatPrice(1250, 'eur', 'en-IE')).toBe('€12.50')
  })

  it('rejects negative or fractional minor-unit amounts', () => {
    expect(() => formatPrice(-1, 'usd')).toThrow(RangeError)
    expect(() => formatPrice(19.5, 'usd')).toThrow(RangeError)
  })

  it('prices the Phuket pass at the launch price in cents', () => {
    expect(PHUKET_PASS.currency).toBe('usd')
    expect(Number.isInteger(PHUKET_PASS.amount)).toBe(true)
    expect(formatPrice(PHUKET_PASS.amount, PHUKET_PASS.currency)).toBe('$19')
  })
})
