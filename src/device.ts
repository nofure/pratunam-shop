// Per-device settings kept in localStorage (NOT synced between devices).
import { useSyncExternalStore } from 'react'

export interface DeviceConfig {
  deviceId: string
  boothId: string | null // booth this device sells for
  syncUrl: string // Google Apps Script web app URL ('' = sync off)
  syncKey: string // shared secret checked by the Apps Script
  lastPullSeq: number // sync cursor
  lastSyncAt: number | null
  lineNotify: boolean // send shift summary to LINE via the sync backend when closing a shift
  autoLockMin: number // lock the screen after N idle minutes (0 = never)
}

const KEY = 'pratunam.device.v1'
const SESSION_KEY = 'pratunam.session.v1'

function randomHex(n: number): string {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

function defaults(): DeviceConfig {
  return {
    deviceId: 'dev-' + randomHex(6),
    boothId: null,
    syncUrl: '',
    syncKey: '',
    lastPullSeq: 0,
    lastSyncAt: null,
    lineNotify: true,
    autoLockMin: 0,
  }
}

let cache: DeviceConfig | null = null
const listeners = new Set<() => void>()

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable (private mode) — keep in memory only */
  }
}

export function getDevice(): DeviceConfig {
  if (cache) return cache
  let parsed: Partial<DeviceConfig> = {}
  const raw = safeGet(KEY)
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = {}
    }
  }
  cache = { ...defaults(), ...parsed }
  if (!raw) safeSet(KEY, JSON.stringify(cache))
  return cache
}

export function setDevice(changes: Partial<DeviceConfig>): DeviceConfig {
  cache = { ...getDevice(), ...changes }
  safeSet(KEY, JSON.stringify(cache))
  listeners.forEach((l) => l())
  return cache
}

export function getDeviceId(): string {
  return getDevice().deviceId
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** React hook: current device config, re-renders on setDevice(). */
export function useDevice(): DeviceConfig {
  return useSyncExternalStore(subscribe, getDevice, getDevice)
}

// ---- login session (who is using this device right now) ----

export function getSessionStaffId(): string | null {
  return safeGet(SESSION_KEY)
}

export function setSessionStaffId(id: string | null): void {
  safeSet(SESSION_KEY, id)
}
