// Shared live-query hooks (re-render automatically when IndexedDB changes).
import { useLiveQuery } from 'dexie-react-hooks'
import { alive, db } from './db'
import { useDevice } from './device'
import type { Booth, ID, Shift, ShopConfig, Staff, Tier } from './types'

export function useShop(): ShopConfig | undefined {
  return useLiveQuery(() => db.shop.get('shop'), [])
}

/** Active booths sorted. `undefined` while loading. */
export function useBooths(includeInactive = false): Booth[] | undefined {
  return useLiveQuery(async () => {
    const rows = alive(await db.booths.orderBy('sort').toArray())
    return includeInactive ? rows : rows.filter((b) => b.active === 1)
  }, [includeInactive])
}

export function useStaffList(includeInactive = false): Staff[] | undefined {
  return useLiveQuery(async () => {
    const rows = alive(await db.staff.toArray()).sort((a, b) =>
      a.role === b.role ? a.name.localeCompare(b.name, 'th') : a.role === 'owner' ? -1 : 1,
    )
    return includeInactive ? rows : rows.filter((s) => s.active === 1)
  }, [includeInactive])
}

/** Price buttons of one booth sorted by `sort`. */
export function useTiers(boothId: ID | null | undefined, includeInactive = false): Tier[] | undefined {
  return useLiveQuery(async () => {
    if (!boothId) return []
    const rows = alive(await db.tiers.where('boothId').equals(boothId).toArray()).sort((a, b) => a.sort - b.sort)
    return includeInactive ? rows : rows.filter((t) => t.active === 1)
  }, [boothId, includeInactive])
}

export function useAllTiers(): Tier[] | undefined {
  return useLiveQuery(async () => alive(await db.tiers.toArray()).sort((a, b) => a.sort - b.sort), [])
}

/** The open shift of a booth (null if none). `undefined` while loading. */
export function useOpenShift(boothId: ID | null | undefined): Shift | null | undefined {
  return useLiveQuery(async () => {
    if (!boothId) return null
    const rows = alive(await db.shifts.where('[boothId+status]').equals([boothId, 'open']).toArray())
    rows.sort((a, b) => b.openedAt - a.openedAt)
    return rows[0] ?? null
  }, [boothId])
}

/** Booth assigned to this device (null if not chosen yet). */
export function useCurrentBooth(): Booth | null | undefined {
  const { boothId } = useDevice()
  return useLiveQuery(async () => {
    if (!boothId) return null
    const b = await db.booths.get(boothId)
    return b && b.deleted !== 1 ? b : null
  }, [boothId])
}
