/**
 * Lets the flying stamp hold the passport dock's counter at its old value until the stamp lands,
 * so the number ticks on impact instead of before the stamp gets there.
 * A hold always ends: on release, or after a safety timeout.
 */
type Listener = (held: boolean) => void

const listeners = new Set<Listener>()
let held = false
let safety: ReturnType<typeof setTimeout> | undefined

function emit(): void {
  listeners.forEach((l) => l(held))
}

export function holdDock(maxMs = 4000): void {
  held = true
  clearTimeout(safety)
  safety = setTimeout(releaseDock, maxMs)
  emit()
}

export function releaseDock(): void {
  clearTimeout(safety)
  if (!held) return
  held = false
  emit()
}

export function isDockHeld(): boolean {
  return held
}

export function onDockHold(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
