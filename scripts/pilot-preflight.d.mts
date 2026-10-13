// Types for scripts/pilot-preflight.mjs, so the TypeScript unit test can import it.

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL'

export interface CheckResult {
  name: string
  status: CheckStatus
  detail: string
}

export const PILOT_CONTRACT_ID: string
export const DEFAULT_RPC_URL: string

export function isValidStrKey(value: unknown, kind: 'S' | 'C'): boolean
export function checkEnv(env: Record<string, string | undefined>, options?: { distBuilt?: boolean }): CheckResult[]
export function checkRpcHealth(body: unknown): CheckResult
export function probeRpc(
  url: string,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
  timeoutMs?: number,
): Promise<CheckResult>
export function formatReport(results: CheckResult[]): { text: string; ok: boolean }
export function checkServerHealth(body: unknown, env: Record<string, string | undefined>): CheckResult[]
export function probeServer(
  baseUrl: string,
  env: Record<string, string | undefined>,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
  timeoutMs?: number,
): Promise<CheckResult[]>
export function parseArgs(argv: string[]): { server?: string; unknown?: string }
