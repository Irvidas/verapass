import { randomBytes } from 'node:crypto'
import { rpc } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import type { CheckinReceipt } from '../../shared/checkin'
import { StellarContractAttestor, TESTNET_RPC_URL } from '../../server/attestor'
import { sha256Hex } from '../../server/receipts'

/**
 * Opt-in test against the real testnet contract. Skipped unless VERAPASS_LIVE_TEST=1 and
 * STELLAR_SECRET (the attestor key) and VERAPASS_CONTRACT_ID are set, in the environment or in
 * .env. Run it with `npm run test:live`. Each run stamps wat-chalong for a fresh random traveller.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // No .env: use the environment as it is.
}

const env = process.env
const enabled = env.VERAPASS_LIVE_TEST === '1' && Boolean(env.STELLAR_SECRET) && Boolean(env.VERAPASS_CONTRACT_ID)

describe.skipIf(!enabled)('live testnet stamp', () => {
  it(
    'activates a passport, mints a stamp, and does not mint twice for the same place',
    async () => {
      const attestor = new StellarContractAttestor({
        secret: env.STELLAR_SECRET ?? '',
        contractId: env.VERAPASS_CONTRACT_ID ?? '',
        addressSecret: randomBytes(32).toString('hex'),
        rpcUrl: env.STELLAR_RPC_URL,
        timeoutMs: 60_000,
      })
      const traveller = `trav_${randomBytes(8).toString('hex')}.live`
      const receipt: CheckinReceipt = {
        traveller,
        placeId: 'wat-chalong',
        distanceM: 0,
        accuracy: 10,
        checkedInAt: Date.now() - 5_000,
        simulated: false,
        proofHash: sha256Hex(`verapass-live-test|${traveller}`),
      }

      const first = await attestor.attest(receipt)
      expect(first.mode).toBe('testnet')
      expect(first.txHash).toMatch(/^[0-9a-f]{64}$/)
      expect(first.explorerUrl).toBe(`https://stellar.expert/explorer/testnet/tx/${first.txHash}`)
      expect(first.contract?.tokenId).toBeGreaterThan(0)

      const server = new rpc.Server(env.STELLAR_RPC_URL ?? TESTNET_RPC_URL)
      expect((await server.getTransaction(first.txHash)).status).toBe('SUCCESS')

      const again = await attestor.attest({ ...receipt, proofHash: sha256Hex(`verapass-live-test-2|${traveller}`) })
      expect(again.contract).toMatchObject({ alreadyStamped: true, tokenId: first.contract?.tokenId })
      expect(again.txHash).toBe('')
    },
    180_000,
  )
})
