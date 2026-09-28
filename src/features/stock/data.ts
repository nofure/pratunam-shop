// Live data for the stock pages + the booth picked on the stock pages.
import { createContext, useContext } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { alive, db } from '../../db'
import { computeStock, type TierStock } from '../../domain/stock'
import type { Adjustment, Booth, ID, Lot, Supplier, Tier } from '../../types'

export interface BoothStock {
  boothId: ID
  /** Every non-deleted tier of the booth (active and hidden), in button order. */
  tiers: Tier[]
  stock: Map<ID, TierStock>
  lots: Lot[]
  adjustments: Adjustment[]
}

/**
 * Stock of one booth: its tiers with lots, adjustments and paid sales.
 * `undefined` = loading, `null` = no booth. Check `data.boothId === boothId` before using a result
 * so a previous booth's numbers are never shown while the new one loads.
 */
export function useBoothStock(boothId: ID | null): BoothStock | null | undefined {
  return useLiveQuery(async (): Promise<BoothStock | null> => {
    if (!boothId) return null
    const tiers = alive(await db.tiers.where('boothId').equals(boothId).toArray()).sort((a, b) => a.sort - b.sort)
    const ids = tiers.map((t) => t.id)
    if (ids.length === 0) return { boothId, tiers, stock: new Map(), lots: [], adjustments: [] }
    const lots = alive(await db.lots.where('tierId').anyOf(ids).toArray())
    const adjustments = alive(await db.adjustments.where('tierId').anyOf(ids).toArray())
    const sales = await db.sales
      .where('boothId')
      .equals(boothId)
      .filter((s) => s.deleted !== 1 && s.status === 'paid')
      .toArray()
    return { boothId, tiers, stock: computeStock(tiers, lots, adjustments, sales), lots, adjustments }
  }, [boothId])
}

/** Every supplier including deleted ones (so old lots still show a name). */
export function useSupplierRows(): Supplier[] | undefined {
  return useLiveQuery(() => db.suppliers.toArray(), [])
}

/** Every tier including deleted ones, for looking up names of old records. */
export function useTierLookup(): Map<ID, Tier> | undefined {
  return useLiveQuery(async () => new Map((await db.tiers.toArray()).map((t) => [t.id, t])), [])
}

export function aliveSuppliersSorted(rows: Supplier[]): Supplier[] {
  return alive(rows).sort((a, b) => a.name.localeCompare(b.name, 'th'))
}

// ---------- booth picked on the stock pages ----------

export interface StockBoothValue {
  /** Booth shown on the stock pages (null = none available / device has no booth). */
  boothId: ID | null
  setBoothId: (id: ID) => void
  /** Active booths the user may switch between (owner only). */
  booths: Booth[]
  /** All booths incl. hidden ones, for names. */
  allBooths: Booth[]
  canPick: boolean
}

export const StockBoothContext = createContext<StockBoothValue | null>(null)

export function useStockBooth(): StockBoothValue {
  const v = useContext(StockBoothContext)
  if (!v) throw new Error('useStockBooth must be used inside the stock pages')
  return v
}

export function boothNameOf(booths: Booth[], id: ID | null | undefined): string {
  if (!id) return 'ไม่ระบุแผง'
  return booths.find((b) => b.id === id)?.name ?? 'แผงที่ลบแล้ว'
}
