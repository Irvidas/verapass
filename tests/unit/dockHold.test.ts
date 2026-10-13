import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdDock, isDockHeld, onDockHold, releaseDock } from '../../src/lib/dockHold'

describe('dock hold (the counter waits for the flying stamp)', () => {
  afterEach(() => {
    releaseDock()
    vi.useRealTimers()
  })

  it('holds until released and tells listeners both times', () => {
    const seen: boolean[] = []
    const off = onDockHold((held) => seen.push(held))
    holdDock()
    expect(isDockHeld()).toBe(true)
    releaseDock()
    expect(isDockHeld()).toBe(false)
    expect(seen).toEqual([true, false])
    off()
  })

  it('a second release is a no-op', () => {
    const listener = vi.fn()
    const off = onDockHold(listener)
    holdDock()
    releaseDock()
    releaseDock()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
  })

  it('always ends: the safety timeout releases a hold nobody released', () => {
    vi.useFakeTimers()
    holdDock(1000)
    vi.advanceTimersByTime(999)
    expect(isDockHeld()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isDockHeld()).toBe(false)
  })

  it('stops notifying a listener after it unsubscribes', () => {
    const listener = vi.fn()
    const off = onDockHold(listener)
    off()
    holdDock()
    expect(listener).not.toHaveBeenCalled()
  })
})
