import { useCallback, useSyncExternalStore } from 'react'
import { buildCurrentUser, type CurrentUser } from '#/lib/current-user'

const STORAGE_KEY = 'agentops:user-id'
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function read(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(STORAGE_KEY) ?? ''
}

export function useUserId(): [string, (next: string) => void] {
  const id = useSyncExternalStore(subscribe, read, () => '')
  const setId = useCallback((next: string) => {
    if (typeof window === 'undefined') return
    const trimmed = next.trim()
    if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed)
    else window.localStorage.removeItem(STORAGE_KEY)
    for (const listener of listeners) listener()
  }, [])
  return [id, setId]
}

export function useUser(): CurrentUser {
  const [id] = useUserId()
  return buildCurrentUser(id)
}
