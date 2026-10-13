import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Keypair } from '@stellar/stellar-sdk'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
/** A random throwaway seed, made per run. Never a real key. */
const SEED = Keypair.random().secret()

const dirs: string[] = []

/** A scratch git repo with the publish check, the licence and package.json, plus the given files. */
function scratchRepo(files: Record<string, string | Buffer> = {}): string {
  const outer = mkdtempSync(join(tmpdir(), 'verapass-publish-check-'))
  dirs.push(outer)
  const dir = join(outer, 'repo')
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  copyFileSync(join(ROOT, 'scripts/publish-check.sh'), join(dir, 'scripts/publish-check.sh'))
  copyFileSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE'))
  copyFileSync(join(ROOT, 'package.json'), join(dir, 'package.json'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  const init = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
  return dir
}

function runCheck(dir: string): { code: number | null; out: string } {
  const res = spawnSync('bash', ['scripts/publish-check.sh'], { cwd: dir, encoding: 'utf8', timeout: 30_000, input: '' })
  return { code: res.status, out: `${res.stdout}${res.stderr}` }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('scripts/publish-check.sh', () => {
  it('passes a clean repo, scanning its own source too', () => {
    const { code, out } = runCheck(scratchRepo({ 'src/app.ts': 'export const ok = 1\n' }))
    expect(out).toContain('ok    no secret or personal-data patterns')
    expect(code).toBe(0)
  })

  it('finds a key in files with spaces, newlines or option-like names, and in binary files', () => {
    const line = `STELLAR_SECRET=${SEED}\n`
    const dir = scratchRepo({
      'notes with space.txt': line,
      'new\nline.txt': line,
      '--': line,
      '-n': line,
      'blob.dat': Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(line)]),
    })
    const { code, out } = runCheck(dir)
    expect(code).toBe(1)
    for (const name of ['notes with space.txt', 'new?line.txt', '--', '-n', 'blob.dat']) {
      expect(out).toContain(`FAIL  ${name}:`)
    }
    // Hits are file:line only.
    expect(out).not.toContain(SEED)
  })

  it('checks a symlink by its link text, never by the file it points to', () => {
    const dir = scratchRepo()
    // A key outside the repo, behind a symlink: git would store only "../outside.txt".
    writeFileSync(join(dir, '..', 'outside.txt'), `${SEED}\n`)
    symlinkSync('../outside.txt', join(dir, 'link'))
    const { code, out } = runCheck(dir)
    expect(out).toContain('WARN  symlink with an absolute or ../ target: link')
    expect(out).not.toMatch(/FAIL {2}link:/)
    expect(out).not.toContain(SEED)
    expect(code).toBe(0)
  })

  it('refuses stellar-cli identities and build output even when they look like images', () => {
    const { code, out } = runCheck(
      scratchRepo({ '.stellar/identity/pilot.toml': 'x\n', 'dist/assets/hero.png': 'x', 'notes/secret-plan.txt': 'x\n', 'public/secret-reef.jpg': 'x' }),
    )
    expect(code).toBe(1)
    expect(out).toContain('forbidden path: .stellar/identity/pilot.toml')
    expect(out).toContain('forbidden path: dist/assets/hero.png')
    expect(out).toContain('forbidden path: notes/secret-plan.txt')
    expect(out).not.toContain('public/secret-reef.jpg')
  })

  it('finds a stellar-cli seed phrase and a token in a .env-style line', () => {
    const words = 'abandon '.repeat(11) + 'about'
    const token = ['AXk', 'Zb3'.repeat(10)].join('')
    const { code, out } = runCheck(scratchRepo({ 'config/id.toml': `seed_phrase = "${words}"\n`, 'deploy/env.txt': `KV_REST_API_TOKEN=${token}\n` }))
    expect(code).toBe(1)
    expect(out).toContain('FAIL  config/id.toml:1 (stellar-cli seed phrase)')
    expect(out).toContain('FAIL  deploy/env.txt:1 (token in a .env-style line)')
    expect(out).not.toContain(token)
  })
})
