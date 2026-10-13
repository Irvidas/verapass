import { Address, Keypair, scValToNative } from '@stellar/stellar-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attestationEnvelope } from '../../shared/checkin'
import { StellarContractAttestor, travellerAddress } from '../../server/attestor'
import { getPlace } from '../../server/places'
import { sha256Hex } from '../../server/receipts'
import { contractError, fakeRpc, item } from '../support/fakeSoroban'
import { newTraveller, setup, TRAVELLER_SECRET, visit } from './helpers'

const CONTRACT_ID = 'CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65'

function place(id: string) {
  const p = getPlace(id)
  if (!p) throw new Error(`${id} missing`)
  return p
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('check-in in mock mode (no STELLAR_SECRET or VERAPASS_CONTRACT_ID)', () => {
  it('reports mock attestation and no contract in /api/health', async () => {
    const res = await setup().get('/api/health')
    expect(await res.json()).toMatchObject({ attestation: 'mock', contractId: null })
  })

  it('confirms a real check-in with a clearly labelled mock record and no contract reference', async () => {
    const ctx = setup()
    const r = await visit(ctx, await newTraveller(ctx), place('wat-chalong'))
    expect(r.status).toBe(200)
    if (r.body.attestation.status !== 'confirmed') throw new Error('expected confirmed')
    const record = r.body.attestation.record
    expect(record.mode).toBe('mock')
    expect(record.id).toMatch(/^mock-/)
    expect(record.contract).toBeUndefined()
    expect(ctx.signer.verify(attestationEnvelope(r.body.receipt.proofHash, record), r.body.attestation.signature)).toBe(true)
  })
})

describe('check-in with the contract attestor (fake Soroban RPC)', () => {
  /** Passports become active once activate_passport is sent, as on the real contract. */
  function live() {
    const keypair = Keypair.random()
    const active = new Set<string>()
    const fake = fakeRpc(keypair, {
      simulate: (call) => {
        const traveller = Address.fromScVal(item(call.args, 0)).toString()
        return call.method === 'stamp' && !active.has(traveller) ? contractError(8) : undefined
      },
    })
    const send = fake.rpc.sendTransaction
    fake.rpc.sendTransaction = vi.fn(async (tx) => {
      const result = await send(tx)
      const last = fake.sent[fake.sent.length - 1]
      if (last?.method === 'activate_passport') active.add(Address.fromScVal(item(last.args, 0)).toString())
      return result
    })
    const attestor = new StellarContractAttestor({ secret: keypair.secret(), contractId: CONTRACT_ID, addressSecret: TRAVELLER_SECRET, rpc: fake.rpc, sleep: () => Promise.resolve() })
    const ctx = setup({ attestor, attestationWaitMs: 2000 })
    return { ctx, fake }
  }

  it('reports the contract in /api/health', async () => {
    const { ctx } = live()
    expect(await (await ctx.get('/api/health')).json()).toMatchObject({ attestation: 'testnet', contractId: CONTRACT_ID })
  })

  it('activates a free passport, mints the stamp and returns the tx hash with stellar.expert links', async () => {
    const { ctx, fake } = live()
    const traveller = await newTraveller(ctx)
    const r = await visit(ctx, traveller, place('wat-chalong'))
    expect(r.status).toBe(200)
    if (r.body.attestation.status !== 'confirmed') throw new Error('expected confirmed')
    const record = r.body.attestation.record
    const address = travellerAddress(traveller, TRAVELLER_SECRET)

    expect(fake.sent.map((s) => s.method)).toEqual(['activate_passport', 'stamp'])
    const ref = Buffer.from(scValToNative(item(item(fake.sent, 0).args, 1)) as Buffer).toString('hex')
    expect(ref).toBe(sha256Hex(`verapass-free-passport-v1|${address}`))
    const receiptHash = Buffer.from(scValToNative(item(item(fake.sent, 1).args, 2)) as Buffer).toString('hex')
    expect(receiptHash).toBe(r.body.receipt.proofHash)

    expect(record).toMatchObject({
      mode: 'testnet',
      id: 'token-1',
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${record.txHash}`,
      contract: { id: CONTRACT_ID, url: `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`, traveller: address, tokenId: 1 },
    })
    expect(record.txHash).toBe(Buffer.from(item(fake.sent, 1).tx.hash()).toString('hex'))
    // The tx link is signed together with the proof hash, so it cannot be swapped.
    expect(ctx.signer.verify(attestationEnvelope(r.body.receipt.proofHash, record), r.body.attestation.signature)).toBe(true)

    // Second place: the passport is already active, so only stamp is sent.
    ctx.advance(30 * 60_000)
    const again = await visit(ctx, traveller, place('big-buddha'))
    expect(again.status).toBe(200)
    expect(fake.sent.map((s) => s.method)).toEqual(['activate_passport', 'stamp', 'stamp'])
  })

  it('activates with sha256 of the Checkout Session id when the traveller paid', async () => {
    const { ctx, fake } = live()
    const traveller = await newTraveller(ctx)
    const checkout = (await (await ctx.post('/api/checkout', { traveller })).json()) as { sessionId: string }
    const r = await visit(ctx, traveller, place('secret-reef'))
    expect(r.status).toBe(200)
    const ref = Buffer.from(scValToNative(item(item(fake.sent, 0).args, 1)) as Buffer).toString('hex')
    expect(ref).toBe(sha256Hex(checkout.sessionId))
  })

  it('never sends a simulated (demo) visit to the chain', async () => {
    const { ctx, fake } = live()
    const r = await visit(ctx, await newTraveller(ctx), place('wat-chalong'), { simulated: true })
    expect(r.status).toBe(200)
    if (r.body.attestation.status !== 'confirmed') throw new Error('expected confirmed')
    expect(r.body.attestation.record.mode).toBe('mock')
    expect(fake.rpc.simulateTransaction).not.toHaveBeenCalled()
    expect(fake.sent).toHaveLength(0)
  })

  it('reports failed, without retrying, when the contract refuses the stamp', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const keypair = Keypair.random()
    const fake = fakeRpc(keypair, { simulate: () => contractError(4) })
    const attestor = new StellarContractAttestor({ secret: keypair.secret(), contractId: CONTRACT_ID, addressSecret: TRAVELLER_SECRET, rpc: fake.rpc, sleep: () => Promise.resolve() })
    const ctx = setup({ attestor, attestationWaitMs: 2000 })
    const r = await visit(ctx, await newTraveller(ctx), place('wat-chalong'))
    expect(r.status).toBe(200)
    expect(r.body.attestation).toMatchObject({ status: 'failed' })
    expect(fake.rpc.simulateTransaction).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('[verapass] attestation failed:', 'stamp was refused by the contract: CreatorRevoked (#4)')
  })
})
