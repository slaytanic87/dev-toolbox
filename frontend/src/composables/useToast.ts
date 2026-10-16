/**
 * Tiny global toast bus - imported by any tool that wants to report something.
 */

import { readonly, ref } from 'vue'

export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

const toasts = ref<Toast[]>([])
let nextId = 0

function push(message: string, tone: ToastTone, durationMs: number): void {
  const id = nextId++
  toasts.value = [...toasts.value, { id, message, tone }]
  window.setTimeout(() => dismiss(id), durationMs)
}

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    dismiss,
    info: (message: string, durationMs = 2600) => push(message, 'info', durationMs),
    success: (message: string, durationMs = 2200) => push(message, 'success', durationMs),
    error: (message: string, durationMs = 4200) => push(message, 'error', durationMs),
  }
}
