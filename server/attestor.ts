import { createHmac } from 'node:crypto'
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  Networks,
  rpc as StellarRpc,
  scValToNative,
  TransactionBuilder,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk'
import type { Attestation, CheckinReceipt } from '../shared/checkin.js'
import { sha256Hex } from './receipts.js'

export const TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org'
export const TESTNET_EXPLORER = 'https://stellar.expert/explorer/testnet/tx/'
export const TESTNET_CONTRACT_EXPLORER = 'https://stellar.expert/explorer/testnet/contract/'

/** What the server knows about the traveller beyond the receipt. */
export interface AttestContext {
  /** Checkout Session id of the traveller's paid pass, if any. Its sha256 becomes the on-chain payment_ref. */
  paymentSessionId?: string
  /**
   * The server-issued traveller id. The on-chain address is derived from it. Receipts carry only
   * a pseudonym of it, so the API passes the id here; without it the receipt's traveller is used.
   */
  traveller?: string
}

/** Records a check-in on Stellar. The server, never the browser, holds the attestor key. */
export interface Attestor {
  readonly mode: Attestation['mode']
  /** The verapass_stamps contract stamps are minted on, when live. */
  readonly contractId?: string
  attest(receipt: CheckinReceipt, context?: AttestContext): Promise<Attestation>
}

/**
 * An attestation that failed. `retryable: false` means trying again cannot help (for example
 * the contract does not know the place), so the queue gives up at once.
 */
export class AttestationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'AttestationError'
  }
}

/**
 * Deterministic stand-in used when STELLAR_SECRET or VERAPASS_CONTRACT_ID is not set, and
 * always for simulated (demo) check-ins. Nothing is written on chain: the ids are derived from
 * the proof hash and the explorer link will not resolve.
 */
export class MockAttestor implements Attestor {
  readonly mode = 'mock' as const

  attest(receipt: CheckinReceipt): Promise<Attestation> {
    const txHash = sha256Hex(`verapass-mock:${receipt.proofHash}`)
    return Promise.resolve({
      mode: 'mock',
      network: 'stellar-testnet',
      id: `mock-${receipt.proofHash.slice(0, 16)}`,
      txHash,
      explorerUrl: `${TESTNET_EXPLORER}${txHash}`,
    })
  }
}

/** The part of the Stellar RPC server the attestor uses. Injected in tests. */
export interface AttestorRpc {
  getAccount(address: string): Promise<Account>
  simulateTransaction(tx: Transaction): Promise<StellarRpc.Api.SimulateTransactionResponse>
  sendTransaction(tx: Transaction): Promise<{ status: 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR'; hash: string }>
  getTransaction(hash: string): Promise<{ status: 'SUCCESS' | 'NOT_FOUND' | 'FAILED'; returnValue?: xdr.ScVal }>
}

/** Error codes of the verapass_stamps contract (contracts/README.md). */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: 'NoPendingAdmin',
  2: 'CreatorAlreadyRegistered',
  3: 'CreatorNotFound',
  4: 'CreatorRevoked',
  5: 'PlaceAlreadyRegistered',
  6: 'PlaceNotFound',
  7: 'InvalidPlaceId',
  8: 'PassportNotActive',
  9: 'PassportAlreadyActive',
  10: 'AlreadyStamped',
  11: 'InvalidTimestamp',
  12: 'NonTransferable',
  13: 'StampNotFound',
}
const PASSPORT_NOT_ACTIVE = 8
const ALREADY_STAMPED = 10

/** The contract error code in a simulation error, or null when the failure was something else. */
export function contractErrorCode(message: string): number | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(message)
  return m?.[1] ? Number(m[1]) : null
}

/**
 * The traveller's Stellar address on the contract. Travellers have no wallet yet, so the server
 * derives a stable pseudonymous address from the traveller id with an HMAC: the chain never sees
 * the id, and nobody without the server secret can link the two. Nobody signs with this key; the
 * contract only needs an address. Wallet-held addresses replace this with passkey wallets.
 */
export function travellerAddress(traveller: string, secret: string): string {
  const seed = createHmac('sha256', secret).update(`verapass-stellar-address-v1|${traveller}`).digest()
  return Keypair.fromRawEd25519Seed(seed).publicKey()
}

/**
 * payment_ref for activate_passport: sha256 of the Checkout Session id when the traveller paid.
 * A traveller who checks in at a free place before paying gets a free-passport ref instead.
 */
export function paymentRef(address: string, paymentSessionId?: string): Buffer {
  const input = paymentSessionId ?? `verapass-free-passport-v1|${address}`
  return Buffer.from(sha256Hex(input), 'hex')
}

export interface ContractAttestorOptions {
  secret: string
  contractId: string
  /** HMAC key for deriving traveller addresses (the server's TRAVELLER_SECRET). */
  addressSecret: string
  rpcUrl?: string
  rpc?: AttestorRpc
  /** How long to poll for a transaction result. */
  timeoutMs?: number
  pollMs?: number
  /** Resends after TRY_AGAIN_LATER, with doubling backoff. */
  maxResends?: number
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Mints a non-transferable stamp on the verapass_stamps Soroban contract for every real check-in:
 * `stamp(traveller, place_id, checkin_receipt_hash, ts)`, signed by the attestor key. When the
 * traveller's passport is not active yet, it first calls `activate_passport`. Each call is built,
 * simulated, assembled with the simulated footprint and fees, signed, sent and polled.
 *
 * Attestations run one at a time: every transaction from the same source account needs the
 * next sequence number, so two in flight would collide (txBAD_SEQ).
 */
export class StellarContractAttestor implements Attestor {
  readonly mode = 'testnet' as const
  private tail: Promise<unknown> = Promise.resolve()
  private account: Account | null = null
  private readonly keypair: Keypair
  private readonly contract: Contract

  constructor(private readonly options: ContractAttestorOptions) {
    this.keypair = Keypair.fromSecret(options.secret)
    this.contract = new Contract(options.contractId)
  }

  get contractId(): string {
    return this.options.contractId
  }

  get publicKey(): string {
    return this.keypair.publicKey()
  }

  attest(receipt: CheckinReceipt, context: AttestContext = {}): Promise<Attestation> {
    const run = this.tail.then(() => this.submit(receipt, context))
    this.tail = run.catch(() => undefined)
    return run
  }

  private rpc(): AttestorRpc {
    this.options.rpc ??= new StellarRpc.Server(this.options.rpcUrl ?? TESTNET_RPC_URL)
    return this.options.rpc
  }

  private async submit(receipt: CheckinReceipt, context: AttestContext): Promise<Attestation> {
    const traveller = travellerAddress(context.traveller ?? receipt.traveller, this.options.addressSecret)
    const stampArgs = [
      new Address(traveller).toScVal(),
      nativeToScVal(receipt.placeId, { type: 'string' }),
      nativeToScVal(Buffer.from(receipt.proofHash, 'hex')),
      nativeToScVal(BigInt(Math.floor(receipt.checkedInAt / 1000)), { type: 'u64' }),
    ]

    let stamp = await this.prepare('stamp', stampArgs)
    if (stamp.code === PASSPORT_NOT_ACTIVE) {
      const activate = await this.prepare('activate_passport', [
        new Address(traveller).toScVal(),
        nativeToScVal(paymentRef(traveller, context.paymentSessionId)),
      ])
      if (!activate.tx) throw this.simulationError('activate_passport', activate)
      await this.send(activate.tx)
      stamp = await this.prepare('stamp', stampArgs)
    }
    if (stamp.code === ALREADY_STAMPED) return this.existingStamp(traveller, receipt.placeId)
    if (!stamp.tx) throw this.simulationError('stamp', stamp)

    const { hash, returnValue } = await this.send(stamp.tx)
    const tokenId = returnValue ? Number(scValToNative(returnValue)) : undefined
    return {
      mode: 'testnet',
      network: 'stellar-testnet',
      id: tokenId !== undefined ? `token-${tokenId}` : hash.slice(0, 16),
      txHash: hash,
      explorerUrl: `${TESTNET_EXPLORER}${hash}`,
      contract: this.contractRef(traveller, tokenId),
    }
  }

  private contractRef(traveller: string, tokenId: number | undefined, alreadyStamped?: boolean): NonNullable<Attestation['contract']> {
    return {
      id: this.options.contractId,
      url: `${TESTNET_CONTRACT_EXPLORER}${this.options.contractId}`,
      traveller,
      ...(tokenId !== undefined ? { tokenId } : {}),
      ...(alreadyStamped ? { alreadyStamped } : {}),
    }
  }

  /**
   * One stamp per traveller and place: a repeat visit does not mint a second one. The record
   * then points at the existing token on the contract, and carries no transaction of its own.
   */
  private async existingStamp(traveller: string, placeId: string): Promise<Attestation> {
    const sim = await this.simulate('get_stamp', [new Address(traveller).toScVal(), nativeToScVal(placeId, { type: 'string' })])
    const retval = StellarRpc.Api.isSimulationSuccess(sim) ? sim.result?.retval : undefined
    const record = retval ? (scValToNative(retval) as { token_id?: number } | undefined) : undefined
    const tokenId = record?.token_id !== undefined ? Number(record.token_id) : undefined
    const contract = this.contractRef(traveller, tokenId, true)
    return {
      mode: 'testnet',
      network: 'stellar-testnet',
      id: tokenId !== undefined ? `token-${tokenId}` : 'already-stamped',
      txHash: '',
      explorerUrl: contract.url,
      contract,
    }
  }

  private async loadAccount(): Promise<Account> {
    this.account ??= await this.rpc().getAccount(this.keypair.publicKey())
    return this.account
  }

  /** Builds a contract call from a copy of the account, so simulating does not use up a sequence number. */
  private async build(method: string, args: xdr.ScVal[]): Promise<Transaction> {
    const account = await this.loadAccount()
    const copy = new Account(account.accountId(), account.sequenceNumber())
    return new TransactionBuilder(copy, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(60)
      .build()
  }

  private async simulate(method: string, args: xdr.ScVal[]): Promise<StellarRpc.Api.SimulateTransactionResponse> {
    return this.rpc().simulateTransaction(await this.build(method, args))
  }

  /** Simulates the call. On success returns the assembled, signed transaction; on failure the error and contract code. */
  private async prepare(method: string, args: xdr.ScVal[]): Promise<{ tx?: Transaction; error?: string; code: number | null }> {
    const raw = await this.build(method, args)
    const sim = await this.rpc().simulateTransaction(raw)
    if (StellarRpc.Api.isSimulationError(sim)) return { error: sim.error, code: contractErrorCode(sim.error) }
    if (StellarRpc.Api.isSimulationRestore(sim)) return { error: 'contract state is archived and needs a restore', code: null }
    const tx = StellarRpc.assembleTransaction(raw, sim).build()
    tx.sign(this.keypair)
    return { tx, code: null }
  }

  private simulationError(method: string, result: { error?: string; code: number | null }): AttestationError {
    if (result.code !== null) {
      const name = CONTRACT_ERRORS[result.code] ?? 'unknown'
      return new AttestationError(`${method} was refused by the contract: ${name} (#${result.code})`, false)
    }
    return new AttestationError(`${method} simulation failed: ${(result.error ?? 'unknown error').slice(0, 300)}`, true)
  }

  private async send(tx: Transaction): Promise<{ hash: string; returnValue?: xdr.ScVal }> {
    const server = this.rpc()
    const sleep = this.options.sleep ?? realSleep
    let sent = await server.sendTransaction(tx)
    for (let resend = 0, wait = 1000; sent.status === 'TRY_AGAIN_LATER' && resend < (this.options.maxResends ?? 3); resend++, wait *= 2) {
      await sleep(wait)
      sent = await server.sendTransaction(tx)
    }
    if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
      // The local sequence number may be off (another sender, or a lost transaction): reload it next time.
      this.account = null
      throw new AttestationError(`Stellar testnet rejected the transaction (${sent.status}, ${sent.hash})`, true)
    }
    // Accepted (PENDING), or already queued (DUPLICATE): the sequence number is used either way.
    this.account?.incrementSequenceNumber()
    const pollMs = this.options.pollMs ?? 1000
    const polls = Math.max(1, Math.ceil((this.options.timeoutMs ?? 30_000) / pollMs))
    for (let i = 0; ; i++) {
      const result = await server.getTransaction(sent.hash)
      if (result.status === 'SUCCESS') return { hash: sent.hash, returnValue: result.returnValue }
      if (result.status === 'FAILED') {
        this.account = null
        throw new AttestationError(`Stellar testnet transaction failed (${sent.hash})`, true)
      }
      if (i + 1 >= polls) {
        this.account = null
        throw new AttestationError(`Stellar testnet transaction timed out (${sent.hash})`, true)
      }
      await sleep(pollMs)
    }
  }
}

export interface AttestorSettings {
  stellarSecret?: string
  contractId?: string
  addressSecret: string
  rpcUrl?: string
}

/** Live mode needs both the attestor key and the contract id; anything less runs the mock. */
export function createAttestor(settings: AttestorSettings): Attestor {
  if (!settings.stellarSecret || !settings.contractId) return new MockAttestor()
  return new StellarContractAttestor({
    secret: settings.stellarSecret,
    contractId: settings.contractId,
    addressSecret: settings.addressSecret,
    rpcUrl: settings.rpcUrl,
  })
}
