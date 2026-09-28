import { useCallback, useSyncExternalStore } from 'react'

/** Live `matchMedia(query).matches`. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      let mql: MediaQueryList
      try {
        mql = window.matchMedia(query)
      } catch {
        return () => {}
      }
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    [query],
  )
  const get = useCallback(() => {
    try {
      return window.matchMedia(query).matches
    } catch {
      return false
    }
  }, [query])
  return useSyncExternalStore(subscribe, get, () => false)
}

/** Tablet / desktop layout: cart panel beside the price grid. */
export const WIDE_QUERY = '(min-width: 900px)'
