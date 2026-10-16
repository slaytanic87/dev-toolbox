/**
 * Listens for images pasted anywhere in the document (Ctrl/Cmd+V).
 * Also understands image URLs pasted as plain text.
 */

import { onBeforeUnmount, onMounted } from 'vue'

export interface ImagePasteHandlers {
  onFile: (file: File) => void
  onUrl?: (url: string) => void
  isEnabled?: () => boolean
}

const IMAGE_URL = /^(https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp|svg)(\?\S*)?|data:image\/[\w+.-]+;base64,\S+)$/i

export function useImagePaste(handlers: ImagePasteHandlers): void {
  function onPaste(event: ClipboardEvent): void {
    if (handlers.isEnabled && !handlers.isEnabled()) return
    const items = event.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          event.preventDefault()
          handlers.onFile(file)
          return
        }
      }
    }

    if (!handlers.onUrl) return
    const text = event.clipboardData?.getData('text/plain')?.trim()
    if (text && IMAGE_URL.test(text)) {
      event.preventDefault()
      handlers.onUrl(text)
    }
  }

  onMounted(() => window.addEventListener('paste', onPaste))
  onBeforeUnmount(() => window.removeEventListener('paste', onPaste))
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)
}
