import { Account, SorobanDataBuilder, xdr, type Keypair, type Transaction } from '@stellar/stellar-sdk'
import { vi } from 'vitest'
import type { AttestorRpc } from '../../server/attestor'

export type SendStatus = Awaited<ReturnType<AttestorRpc['sendTransaction']>>['status']
export type TxStatus = Awaited<ReturnType<AttestorRpc['getTransaction']>>['status']
export type SimAnswer = { error: string } | { retval: xdr.ScVal }

export interface Call {
  method: string
  args: xdr.ScVal[]
}

export function callOf(tx: Transaction): Call {
  const op = tx.operations[0]
  if (op?.type !== 'invokeHostFunction') throw new Error(`expected a contract call, got ${op?.type}`)
  const fn = op.func
  if (fn.type !== 'hostFunctionTypeInvokeContract') throw new Error(`expected invokeContract, got ${fn.type}`)
  return { method: String(fn.invokeContract.functionName), args: fn.invokeContract.args }
}

/**
 * A fake Soroban RPC. Simulation answers come from `simulate` (undefined or no callback: success); send and poll answers are scripted. Records every simulated and sent call.
 */
export function fakeRpc(keypair: Keypair, script: { simulate?: (call: Call) => SimAnswer | undefined; send?: SendStatus[]; poll?: TxStatus[] } = {}) {
  const sends = [...(script.send ?? [])]
  const polls = [...(script.poll ?? [])]
  const simulated: Call[] = []
  const sent: (Call & { sequence: string; tx: Transaction })[] = []
  const returns = new Map<string, xdr.ScVal>()
  let nextToken = 1
  const rpcFake: AttestorRpc = {
    getAccount: vi.fn(async () => new Account(keypair.publicKey(), '100')),
    simulateTransaction: vi.fn(async (tx: Transaction) => {
      const call = callOf(tx)
      simulated.push(call)
      const answer = script.simulate?.(call) ?? { retval: call.method === 'stamp' ? xdr.ScVal.scvU32(0) : xdr.ScVal.scvVoid() }
      const base = { id: '1', latestLedger: 1000, events: [], _parsed: true as const }
      if ('error' in answer) return { ...base, error: answer.error }
      return { ...base, transactionData: new SorobanDataBuilder().setResourceFee(5000), minResourceFee: '5000', result: { auth: [], retval: answer.retval } }
    }),
    sendTransaction: vi.fn(async (tx: Transaction) => {
      const hash = Buffer.from(tx.hash()).toString('hex')
      const call = callOf(tx)
      sent.push({ ...call, sequence: tx.sequence, tx })
      if (call.method === 'stamp') returns.set(hash, xdr.ScVal.scvU32(nextToken++))
      return { status: sends.shift() ?? 'PENDING', hash }
    }),
    getTransaction: vi.fn(async (hash: string) => ({ status: polls.shift() ?? 'SUCCESS', returnValue: returns.get(hash) })),
  }
  return { rpc: rpcFake, simulated, sent }
}

/** A simulation error as the RPC reports a contract error. */
export const contractError = (code: number) => ({ error: `HostError: Error(Contract, #${code})\n\nEvent log (newest first): ...` })

/** list[i], failing the test when it is missing. */
export function item<T>(list: readonly T[], i: number): T {
  const value = list[i]
  if (value === undefined) throw new Error(`expected an item at index ${i}, got ${list.length} items`)
  return value
}
