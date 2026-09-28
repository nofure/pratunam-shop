// The POS cart: one per booth, kept in memory and mirrored to localStorage so it survives
// switching tabs, a reload, or Android killing the app while the seller checks the bank app.
import { useCallback, useSyncExternalStore } from 'react'
import type { CartLine } from '../../domain/pricing'
import type { ID } from '../../types'

export interface CartState {
  lines: CartLine[]
  /** Manual discount (ลูกค้าต่อ) as entered; computeCart() clamps it to the bill. */
  discount: number
}

export const EMPTY_CART: CartState = Object.freeze({ lines: [], discount: 0 }) as CartState

const PREFIX = 'pratunam.pos.cart.v1:'
/** A cart left untouched this long is dropped (yesterday's unfinished bill should not come back). */
const MAX_AGE_MS = 12 * 60 * 60 * 1000

const carts = new Map<ID, CartState>()
const listeners = new Set<() => void>()

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNumOrNull(v: unknown): v is number | null {
  return v === null || isNum(v)
}

function validLine(v: unknown): v is CartLine {
  if (!v || typeof v !== 'object') return false
  const l = v as Record<string, unknown>
  return (
    typeof l.key === 'string' &&
    l.key !== '' &&
    (l.tierId === null || typeof l.tierId === 'string') &&
    typeof l.name === 'string' &&
    typeof l.unit === 'string' &&
    isNum(l.price) &&
    l.price >= 0 &&
    isNum(l.qty) &&
    Number.isInteger(l.qty) &&
    l.qty > 0 &&
    isNumOrNull(l.promoQty) &&
    isNumOrNull(l.promoPrice)
  )
}

/** Parse a stored cart; anything malformed or too old becomes an empty cart. */
export function parseCart(raw: string | null, now = Date.now()): CartState {
  if (!raw) return EMPTY_CART
  try {
    const o = JSON.parse(raw) as { lines?: unknown; discount?: unknown; at?: unknown }
    if (!o || typeof o !== 'object' || !Array.isArray(o.lines)) return EMPTY_CART
    if (isNum(o.at) && now - o.at > MAX_AGE_MS) return EMPTY_CART
    const seen = new Set<string>()
    const lines: CartLine[] = []
    for (const l of o.lines) {
      if (!validLine(l) || seen.has(l.key)) continue
      seen.add(l.key)
      lines.push({
        key: l.key,
        tierId: l.tierId,
        name: l.name,
        unit: l.unit,
        price: l.price,
        qty: l.qty,
        promoQty: l.promoQty,
        promoPrice: l.promoPrice,
      })
    }
    if (lines.length === 0) return EMPTY_CART
    const discount = isNum(o.discount) && o.discount > 0 ? o.discount : 0
    return { lines, discount }
  } catch {
    return EMPTY_CART
  }
}

function persist(boothId: ID, cart: CartState): void {
  const s = store()
  if (!s) return
  try {
    if (cart.lines.length === 0) s.removeItem(PREFIX + boothId)
    else s.setItem(PREFIX + boothId, JSON.stringify({ lines: cart.lines, discount: cart.discount, at: Date.now() }))
  } catch {
    /* storage full / unavailable — the in-memory cart still works */
  }
}

export function getCart(boothId: ID | null | undefined): CartState {
  if (!boothId) return EMPTY_CART
  let c = carts.get(boothId)
  if (!c) {
    let raw: string | null = null
    try {
      raw = store()?.getItem(PREFIX + boothId) ?? null
    } catch {
      raw = null
    }
    c = parseCart(raw)
    carts.set(boothId, c)
  }
  return c
}

export function updateCart(boothId: ID, fn: (c: CartState) => CartState): void {
  const cur = getCart(boothId)
  const next = fn(cur)
  if (next === cur) return
  // An empty cart never keeps a stale discount.
  const normalized = next.lines.length === 0 ? EMPTY_CART : next
  carts.set(boothId, normalized)
  persist(boothId, normalized)
  listeners.forEach((l) => l())
}

export function clearCart(boothId: ID): void {
  updateCart(boothId, () => EMPTY_CART)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** React hook: the cart of a booth and an updater. */
export function useCart(boothId: ID | null | undefined): [CartState, (fn: (c: CartState) => CartState) => void] {
  const snapshot = useCallback(() => getCart(boothId), [boothId])
  const cart = useSyncExternalStore(subscribe, snapshot, snapshot)
  const update = useCallback(
    (fn: (c: CartState) => CartState) => {
      if (boothId) updateCart(boothId, fn)
    },
    [boothId],
  )
  return [cart, update]
}
