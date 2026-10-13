import { describe, expect, it } from 'vitest'
import type { AttestationStatus } from '../../shared/checkin'
import { explorerHref } from '../../src/lib/explorer'
import { isStamp } from '../../src/lib/passport'
import { stamp } from './fixtures'

const CONTRACT = 'CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65'

function onChain(contract: unknown): AttestationStatus {
  return {
    status: 'confirmed',
    signature: 'sig',
    record: {
      mode: 'testnet',
      network: 'stellar-testnet',
      id: 'token-3',
      txHash: 'ab'.repeat(32),
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${'ab'.repeat(32)}`,
      contract: contract as never,
    },
  }
}

describe('explorerHref', () => {
  it('links only to the stellar.expert testnet explorer', () => {
    expect(explorerHref(`https://stellar.expert/explorer/testnet/contract/${CONTRACT}`)).toBe(`https://stellar.expert/explorer/testnet/contract/${CONTRACT}`)
    expect(explorerHref('javascript:alert(1)')).toBeNull()
    expect(explorerHref('https://stellar.expert.evil.example/explorer/testnet/tx/1')).toBeNull()
    expect(explorerHref('https://stellar.expert/explorer/public/tx/1')).toBeNull()
    expect(explorerHref('https://stellar.expert/explorer/testnet/tx/1"onmouseover=x')).toBeNull()
    expect(explorerHref(undefined)).toBeNull()
  })
})

describe('isStamp with a contract record', () => {
  it('accepts a stamp minted on the contract, and one already on chain', () => {
    const ref = { id: CONTRACT, url: `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`, traveller: 'GAO3', tokenId: 3 }
    expect(isStamp(stamp('wat-chalong', undefined, onChain(ref)))).toBe(true)
    expect(isStamp(stamp('wat-chalong', undefined, onChain({ ...ref, alreadyStamped: true })))).toBe(true)
    expect(isStamp(stamp('wat-chalong', undefined, onChain(undefined)))).toBe(true)
  })

  it('rejects a malformed contract reference', () => {
    const ref = { id: CONTRACT, url: 'https://stellar.expert/explorer/testnet/contract/x', traveller: 'GAO3' }
    expect(isStamp(stamp('wat-chalong', undefined, onChain({ ...ref, tokenId: '3' })))).toBe(false)
    expect(isStamp(stamp('wat-chalong', undefined, onChain({ ...ref, alreadyStamped: 'yes' })))).toBe(false)
    expect(isStamp(stamp('wat-chalong', undefined, onChain({ id: CONTRACT })))).toBe(false)
    expect(isStamp(stamp('wat-chalong', undefined, onChain('contract')))).toBe(false)
  })
})
