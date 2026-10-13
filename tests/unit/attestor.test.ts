import { Address, Keypair, rpc, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckinReceipt } from '../../shared/checkin'
import { AttestationQueue } from '../../server/attestations'
import {
  AttestationError,
  contractErrorCode,
  createAttestor,
  MockAttestor,
  paymentRef,
  StellarContractAttestor,
  travellerAddress,
  type AttestorRpc,
} from '../../server/attestor'
import { createReceiptSigner, sha256Hex } from '../../server/receipts'
import { callOf, contractError, fakeRpc, item, type TxStatus } from '../support/fakeSoroban'

const CONTRACT_ID = 'CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65'
const ADDRESS_SECRET = 'unit-test-traveller-secret'
const TRAVELLER = 'trav_0123456789abcdef.x'

function receipt(n: number, placeId = 'wat-chalong'): CheckinReceipt {
  return { traveller: TRAVELLER, placeId, distanceM: 5, accuracy: 9, checkedInAt: 1_760_000_000_000 + n * 1000, simulated: false, proofHash: sha256Hex(`proof-${n}`) }
}

const noSleep = () => Promise.resolve()

function attestorWith(keypair: Keypair, rpcFake: AttestorRpc, extra: Partial<ConstructorParameters<typeof StellarContractAttestor>[0]> = {}) {
  return new StellarContractAttestor({ secret: keypair.secret(), contractId: CONTRACT_ID, addressSecret: ADDRESS_SECRET, rpc: rpcFake, sleep: noSleep, ...extra })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('travellerAddress', () => {
  it('derives a stable Stellar address per traveller that depends on the server secret', () => {
    const a = travellerAddress(TRAVELLER, ADDRESS_SECRET)
    expect(StrKey.isValidEd25519PublicKey(a)).toBe(true)
    expect(travellerAddress(TRAVELLER, ADDRESS_SECRET)).toBe(a)
    expect(travellerAddress('trav_fedcba9876543210.y', ADDRESS_SECRET)).not.toBe(a)
    expect(travellerAddress(TRAVELLER, 'another-secret-value')).not.toBe(a)
  })
})

describe('paymentRef', () => {
  it('is sha256 of the Checkout Session id when paid, and a free-passport ref otherwise', () => {
    expect(paymentRef('GABC', 'cs_test_123').toString('hex')).toBe(sha256Hex('cs_test_123'))
    expect(paymentRef('GABC').toString('hex')).toBe(sha256Hex('verapass-free-passport-v1|GABC'))
    expect(paymentRef('GABC')).toHaveLength(32)
  })
})

describe('contractErrorCode', () => {
  it('reads the contract error code from a simulation error', () => {
    expect(contractErrorCode('HostError: Error(Contract, #10)')).toBe(10)
    expect(contractErrorCode('HostError: Error(Auth, InvalidAction)')).toBeNull()
  })
})

describe('StellarContractAttestor', () => {
  it('calls stamp(traveller, place_id, receipt hash, ts), signed by the attestor, and returns the token and links', async () => {
    const keypair = Keypair.random()
    const { rpc: fake, sent } = fakeRpc(keypair, { poll: ['NOT_FOUND', 'SUCCESS'] })
    const a = await attestorWith(keypair, fake).attest(receipt(1))

    expect(sent).toHaveLength(1)
    const call = item(sent, 0)
    expect(call.method).toBe('stamp')
    const [traveller, placeId, hash, ts] = [item(call.args, 0), item(call.args, 1), item(call.args, 2), item(call.args, 3)]
    expect(Address.fromScVal(traveller).toString()).toBe(travellerAddress(TRAVELLER, ADDRESS_SECRET))
    expect(placeId.type).toBe('scvString')
    expect(scValToNative(placeId)).toBe('wat-chalong')
    expect(Buffer.from(scValToNative(hash) as Buffer).toString('hex')).toBe(receipt(1).proofHash)
    expect(ts.type).toBe('scvU64')
    expect(scValToNative(ts)).toBe(BigInt(Math.floor(receipt(1).checkedInAt / 1000)))

    // Assembled from the simulation (resource fee added) and signed by the attestor key.
    expect(Number(call.tx.fee)).toBeGreaterThan(5000)
    expect(call.tx.signatures).toHaveLength(1)
    expect(keypair.verify(call.tx.hash(), item(call.tx.signatures, 0).signature)).toBe(true)
    expect(call.tx.source).toBe(keypair.publicKey())

    expect(a).toMatchObject({
      mode: 'testnet',
      network: 'stellar-testnet',
      id: 'token-1',
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${a.txHash}`,
      contract: {
        id: CONTRACT_ID,
        url: `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`,
        traveller: travellerAddress(TRAVELLER, ADDRESS_SECRET),
        tokenId: 1,
      },
    })
    expect(a.txHash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.contract?.alreadyStamped).toBeUndefined()
  })

  it('activates the passport with sha256(Checkout Session id) first when the contract says it is not active', async () => {
    const keypair = Keypair.random()
    let active = false
    const { rpc: fake, sent } = fakeRpc(keypair, {
      simulate: (call) => (call.method === 'stamp' && !active ? contractError(8) : { retval: xdr.ScVal.scvU32(0) }),
    })
    vi.mocked(fake.sendTransaction).mockImplementationOnce(async (tx) => {
      active = true
      sent.push({ ...callOf(tx), sequence: tx.sequence, tx })
      return { status: 'PENDING', hash: Buffer.from(tx.hash()).toString('hex') }
    })
    const a = await attestorWith(keypair, fake).attest(receipt(1), { paymentSessionId: 'cs_test_paid' })

    expect(sent.map((s) => s.method)).toEqual(['activate_passport', 'stamp'])
    expect(sent.map((s) => s.sequence)).toEqual(['101', '102'])
    const [traveller, ref] = [item(item(sent, 0).args, 0), item(item(sent, 0).args, 1)]
    expect(Address.fromScVal(traveller).toString()).toBe(travellerAddress(TRAVELLER, ADDRESS_SECRET))
    expect(Buffer.from(scValToNative(ref) as Buffer).toString('hex')).toBe(sha256Hex('cs_test_paid'))
    expect(a.mode).toBe('testnet')
  })

  it('uses the free-passport ref when the traveller has not paid', async () => {
    const keypair = Keypair.random()
    let active = false
    const { rpc: fake, sent } = fakeRpc(keypair, {
      simulate: (call) => {
        if (call.method === 'activate_passport') active = true
        return call.method === 'stamp' && !active ? contractError(8) : { retval: xdr.ScVal.scvVoid() }
      },
    })
    await attestorWith(keypair, fake).attest(receipt(1))
    const address = travellerAddress(TRAVELLER, ADDRESS_SECRET)
    expect(Buffer.from(scValToNative(item(item(sent, 0).args, 1)) as Buffer).toString('hex')).toBe(sha256Hex(`verapass-free-passport-v1|${address}`))
  })

  it('does not mint twice: a repeat visit returns the existing token on the contract', async () => {
    const keypair = Keypair.random()
    const existing = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('checked_in_at'), val: xdr.ScVal.scvU64(1n) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('token_id'), val: xdr.ScVal.scvU32(7) }),
    ])
    const { rpc: fake, sent, simulated } = fakeRpc(keypair, {
      simulate: (call) => (call.method === 'stamp' ? contractError(10) : { retval: existing }),
    })
    const a = await attestorWith(keypair, fake).attest(receipt(2))
    expect(sent).toHaveLength(0)
    expect(simulated.map((c) => c.method)).toEqual(['stamp', 'get_stamp'])
    expect(a).toMatchObject({
      mode: 'testnet',
      id: 'token-7',
      txHash: '',
      explorerUrl: `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`,
      contract: { tokenId: 7, alreadyStamped: true },
    })
  })

  it('a contract refusal is not retryable, and the queue gives up at once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const keypair = Keypair.random()
    const { rpc: fake, sent } = fakeRpc(keypair, { simulate: () => contractError(6) })
    const attestor = attestorWith(keypair, fake)
    const err = await attestor.attest(receipt(1)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AttestationError)
    expect((err as AttestationError).retryable).toBe(false)
    expect((err as Error).message).toContain('PlaceNotFound (#6)')
    expect(sent).toHaveLength(0)

    const spy = vi.spyOn(attestor, 'attest')
    const queue = new AttestationQueue(attestor, createReceiptSigner(), { retries: 2, sleep: noSleep })
    expect(await queue.submit(receipt(2))).toMatchObject({ status: 'failed' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('a simulation failure without a contract code is retryable', async () => {
    const keypair = Keypair.random()
    const { rpc: fake } = fakeRpc(keypair, { simulate: () => ({ error: 'HostError: Error(Budget, ExceededLimit)' }) })
    const err = await attestorWith(keypair, fake).attest(receipt(1)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AttestationError)
    expect((err as AttestationError).retryable).toBe(true)
  })

  it('runs concurrent attestations one at a time with increasing sequence numbers (no txBAD_SEQ)', async () => {
    const keypair = Keypair.random()
    const { rpc: fake, sent } = fakeRpc(keypair)
    const attestor = attestorWith(keypair, fake)
    const results = await Promise.all([attestor.attest(receipt(1)), attestor.attest(receipt(2, 'old-town')), attestor.attest(receipt(3, 'big-buddha'))])
    expect(new Set(results.map((r) => r.txHash)).size).toBe(3)
    expect(results.map((r) => r.contract?.tokenId)).toEqual([1, 2, 3])
    expect(sent.map((s) => s.sequence)).toEqual(['101', '102', '103'])
    expect(fake.getAccount).toHaveBeenCalledTimes(1)
  })

  it('resends after TRY_AGAIN_LATER, with backoff', async () => {
    const keypair = Keypair.random()
    const { rpc: fake } = fakeRpc(keypair, { send: ['TRY_AGAIN_LATER', 'TRY_AGAIN_LATER', 'PENDING'] })
    const sleep = vi.fn((ms: number) => Promise.resolve(void ms))
    await attestorWith(keypair, fake, { sleep }).attest(receipt(1))
    expect(fake.sendTransaction).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000])
  })

  it('treats DUPLICATE as already queued and waits for the result', async () => {
    const keypair = Keypair.random()
    const { rpc: fake } = fakeRpc(keypair, { send: ['DUPLICATE'], poll: ['SUCCESS'] })
    await expect(attestorWith(keypair, fake).attest(receipt(1))).resolves.toMatchObject({ mode: 'testnet' })
  })

  it('fails on ERROR and reloads the account sequence for the next attestation', async () => {
    const keypair = Keypair.random()
    const { rpc: fake, sent } = fakeRpc(keypair, { send: ['ERROR', 'PENDING'] })
    const attestor = attestorWith(keypair, fake)
    await expect(attestor.attest(receipt(1))).rejects.toThrow(/rejected the transaction \(ERROR/)
    await expect(attestor.attest(receipt(2))).resolves.toMatchObject({ mode: 'testnet' })
    expect(fake.getAccount).toHaveBeenCalledTimes(2)
    expect(sent.map((s) => s.sequence)).toEqual(['101', '101'])
  })

  it('fails on FAILED and on a timeout', async () => {
    const keypair = Keypair.random()
    const failed = attestorWith(keypair, fakeRpc(keypair, { poll: ['FAILED'] }).rpc)
    await expect(failed.attest(receipt(1))).rejects.toThrow(/transaction failed/)
    const slow = attestorWith(keypair, fakeRpc(keypair, { poll: Array<TxStatus>(10).fill('NOT_FOUND') }).rpc, { timeoutMs: 3000, pollMs: 1000 })
    await expect(slow.attest(receipt(2))).rejects.toThrow(/timed out/)
  })

  it('a failure does not block the attestations queued behind it', async () => {
    const keypair = Keypair.random()
    const { rpc: fake } = fakeRpc(keypair, { send: ['ERROR', 'PENDING'] })
    const attestor = attestorWith(keypair, fake)
    const [a, b] = await Promise.allSettled([attestor.attest(receipt(1)), attestor.attest(receipt(2))])
    expect(a.status).toBe('rejected')
    expect(b.status).toBe('fulfilled')
  })

  it('creates a real rpc.Server for the configured URL when none is injected', () => {
    const attestor = new StellarContractAttestor({ secret: Keypair.random().secret(), contractId: CONTRACT_ID, addressSecret: ADDRESS_SECRET })
    expect(attestor.contractId).toBe(CONTRACT_ID)
    expect(new rpc.Server('https://soroban-testnet.stellar.org').serverURL.toString()).toContain('soroban-testnet')
  })
})

describe('createAttestor', () => {
  it('runs the mock unless both the attestor key and the contract id are set', () => {
    const secret = Keypair.random().secret()
    expect(createAttestor({ addressSecret: ADDRESS_SECRET })).toBeInstanceOf(MockAttestor)
    expect(createAttestor({ stellarSecret: secret, addressSecret: ADDRESS_SECRET })).toBeInstanceOf(MockAttestor)
    expect(createAttestor({ contractId: CONTRACT_ID, addressSecret: ADDRESS_SECRET })).toBeInstanceOf(MockAttestor)
    const live = createAttestor({ stellarSecret: secret, contractId: CONTRACT_ID, addressSecret: ADDRESS_SECRET })
    expect(live).toBeInstanceOf(StellarContractAttestor)
    expect(live.contractId).toBe(CONTRACT_ID)
  })
})

describe('AttestationQueue', () => {
  it('retries a failing attestor, then reports failed without throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const attest = vi.fn().mockRejectedValue(new Error('rpc down'))
    const queue = new AttestationQueue({ mode: 'testnet', attest }, createReceiptSigner(), { retries: 2, sleep: noSleep })
    const status = await queue.submit(receipt(1))
    expect(status).toMatchObject({ status: 'failed' })
    expect(attest).toHaveBeenCalledTimes(3)
    expect(await queue.get(receipt(1).proofHash)).toMatchObject({ status: 'failed' })
    expect(error).toHaveBeenCalledWith('[verapass] attestation failed:', 'rpc down')
  })

  it('passes the payment context through to the attestor', async () => {
    const mock = new MockAttestor()
    const attest = vi.fn((r: CheckinReceipt) => mock.attest(r))
    const queue = new AttestationQueue({ mode: 'testnet', attest }, createReceiptSigner(), { sleep: noSleep })
    await queue.submit(receipt(1), { paymentSessionId: 'cs_test_1' })
    expect(attest).toHaveBeenCalledWith(receipt(1), { paymentSessionId: 'cs_test_1' })
  })

  it('recovers when a retry succeeds and signs the record with the proof hash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const mock = new MockAttestor()
    const attest = vi.fn().mockRejectedValueOnce(new Error('blip')).mockImplementation((r: CheckinReceipt) => mock.attest(r))
    const signer = createReceiptSigner()
    const queue = new AttestationQueue({ mode: 'testnet', attest }, signer, { retries: 1, sleep: noSleep })
    const status = await queue.submit(receipt(1))
    if (status.status !== 'confirmed') throw new Error('expected confirmed')
    expect(signer.verify({ proofHash: receipt(1).proofHash, record: status.record }, status.signature)).toBe(true)
  })

  it('tracks pending work and serves the status by proof hash', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const mock = new MockAttestor()
    const queue = new AttestationQueue({ mode: 'testnet', attest: async (r: CheckinReceipt) => (await gate, mock.attest(r)) }, createReceiptSigner(), { sleep: noSleep })
    const done = queue.submit(receipt(1))
    expect(await queue.get(receipt(1).proofHash)).toEqual({ status: 'pending' })
    expect(queue.backlog()).toBe(1)
    release()
    await done
    expect(queue.backlog()).toBe(0)
    expect((await queue.get(receipt(1).proofHash))?.status).toBe('confirmed')
  })
})
