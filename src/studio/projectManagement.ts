import { useEffect, useReducer } from 'react'

type Credential = { key: string; deletedName?: string; deletedLifecycle?: number }
const prefix = `remixrelay:management:${encodeURIComponent(import.meta.env.VITE_CONVEX_URL ?? 'local')}:`
const changed = 'remixrelay-management-changed'

export function credentialFor(id: string): Credential | undefined {
  try {
    const record: Credential = JSON.parse(localStorage.getItem(prefix + id) ?? 'null')
    return record && /^[a-f0-9]{64}$/.test(record.key) ? record : undefined
  } catch { return undefined }
}

export function rememberCredential(id: string, record: Credential) {
  localStorage.setItem(prefix + id, JSON.stringify(record))
  window.dispatchEvent(new Event(changed))
}

/** Persist before creation so storage denial never creates an unmanaged project. */
export async function newCredential() {
  const key = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(byte => byte.toString(16).padStart(2, '0')).join('')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
  localStorage.setItem(prefix + 'pending', JSON.stringify({ key }))
  return { key, hash }
}

export function finishCredential(id: string, key: string) {
  rememberCredential(id, { key })
  localStorage.removeItem(prefix + 'pending')
}

/** Keys never enter share URLs, public query arguments/results, or logs. */
export function useManagementCredentials() {
  const [, refresh] = useReducer(value => value + 1, 0)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(prefix)) refresh() }
    window.addEventListener('storage', onStorage)
    window.addEventListener(changed, refresh)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(changed, refresh) }
  }, [])
  const deleted: { id: string; name: string; lifecycle: number }[] = []
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const storageKey = localStorage.key(index)
      if (!storageKey?.startsWith(prefix) || storageKey === prefix + 'pending') continue
      const id = storageKey.slice(prefix.length)
      const record = credentialFor(id)
      if (record?.deletedName && Number.isSafeInteger(record.deletedLifecycle)) deleted.push({ id, name: record.deletedName, lifecycle: record.deletedLifecycle! })
    }
  } catch { /* Storage denial does not grant management access. */ }
  return deleted
}
