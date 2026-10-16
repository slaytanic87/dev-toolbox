/**
 * `ref` that transparently mirrors its value into `localStorage`,
 * so tool inputs survive a page reload.
 */

import { ref, watch, type Ref } from 'vue'

const PREFIX = 'devtoolbox:'

export function usePersistentState<T>(key: string, initial: T): Ref<T> {
  const storageKey = PREFIX + key
  const state = ref<T>(readValue(storageKey, initial)) as Ref<T>

  watch(
    state,
    (value) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(value))
      } catch {
        /* storage full or disabled - keep working in memory */
      }
    },
    { deep: true },
  )

  return state
}

function readValue<T>(storageKey: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function clearPersistentState(): void {
  const keys: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (key?.startsWith(PREFIX)) keys.push(key)
  }
  for (const key of keys) window.localStorage.removeItem(key)
}
