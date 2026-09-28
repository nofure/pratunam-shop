// The phone's back button closes the top modal (see layer.ts). Browser history is simulated:
// pushState/replaceState are synchronous, back() fires popstate on a later task like a browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Layer = typeof import('./layer')

class FakeHistory {
  entries: { state: unknown }[] = [{ state: { idx: 0, key: 'k0' } }]
  index = 0
  constructor(private readonly fire: () => void) {}
  get state(): unknown {
    return this.entries[this.index].state
  }
  get length(): number {
    return this.entries.length
  }
  pushState(state: unknown): void {
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ state })
    this.index++
  }
  replaceState(state: unknown): void {
    this.entries[this.index] = { state }
  }
  back(): void {
    setTimeout(() => {
      if (this.index === 0) return
      this.index--
      this.fire()
    }, 0)
  }
}

let history: FakeHistory
let listeners: (() => void)[]
let layer: Layer

const tick = () => new Promise((r) => setTimeout(r, 5))
const onGuard = () => (history.state as Record<string, unknown> | null)?.pratunamModal === 1
const el = () => ({}) as HTMLElement

/** A modal as Modal.tsx registers it: back calls onClose, which unmounts it (pop). */
function openModal(closeOnBack = true) {
  const m = { closes: 0, pop: () => {} }
  const node = el()
  m.pop = layer.pushLayer(node, () => {
    m.closes++
    if (closeOnBack) m.pop()
  })
  return m
}

beforeEach(async () => {
  listeners = []
  history = new FakeHistory(() => listeners.forEach((l) => l()))
  vi.stubGlobal('window', {
    history,
    addEventListener: (type: string, l: () => void) => {
      if (type === 'popstate') listeners.push(l)
    },
    removeEventListener: () => {},
  })
  vi.resetModules()
  layer = await import('./layer')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('modal layers and the back button', () => {
  it('opening a modal adds one history entry that keeps the router state', () => {
    openModal()
    expect(history.length).toBe(2)
    expect(onGuard()).toBe(true)
    expect(history.state).toMatchObject({ idx: 0, key: 'k0' })
  })

  it('back closes the modal and stays on the page', async () => {
    const m = openModal()
    history.back()
    await tick()
    expect(m.closes).toBe(1)
    expect(history.index).toBe(0)
    expect(onGuard()).toBe(false)
  })

  it('closing with a button removes the extra entry without closing anything else', async () => {
    const m = openModal()
    m.pop()
    await tick()
    expect(history.index).toBe(0)
    expect(m.closes).toBe(0)
  })

  it('nested modals: back closes only the top one and re-arms for the one below', async () => {
    const a = openModal()
    const b = openModal()
    expect(history.length).toBe(2) // one entry for any number of open modals
    history.back()
    await tick()
    expect(b.closes).toBe(1)
    expect(a.closes).toBe(0)
    expect(onGuard()).toBe(true)
    history.back()
    await tick()
    expect(a.closes).toBe(1)
    expect(onGuard()).toBe(false)
  })

  it('a modal that refuses to close (e.g. while saving) keeps the back button armed', async () => {
    const m = openModal(false)
    history.back()
    await tick()
    expect(m.closes).toBe(1)
    expect(onGuard()).toBe(true)
    m.pop()
    await tick()
    expect(onGuard()).toBe(false)
  })

  it('close + reopen in one go (React StrictMode, or one sheet replacing another) stays open', async () => {
    const first = openModal()
    first.pop() // queues history.back()
    const second = openModal()
    await tick()
    expect(second.closes).toBe(0)
    expect(onGuard()).toBe(true)
    history.back()
    await tick()
    expect(second.closes).toBe(1)
  })

  it('back with no modal open is left to the router', async () => {
    history.pushState({ idx: 1, key: 'k1' })
    history.back()
    await tick()
    expect(history.index).toBe(0)
  })

  it('a leftover entry from a reload is made a plain entry again', async () => {
    history.pushState({ idx: 0, key: 'k0', pratunamModal: 1 })
    vi.resetModules()
    layer = await import('./layer')
    const m = openModal() // first use installs the listener and cleans the leftover
    expect(history.length).toBe(3)
    expect((history.entries[1].state as Record<string, unknown>).pratunamModal).toBeUndefined()
    m.pop()
    await tick()
    expect(history.index).toBe(1)
  })
})
