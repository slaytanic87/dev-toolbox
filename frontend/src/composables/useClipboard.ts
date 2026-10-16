/**
 * Clipboard + file download helpers with a graceful fallback for
 * browsers/contexts where the async clipboard API is unavailable.
 */

import { useToast } from './useToast'

export function useClipboard() {
  const toast = useToast()

  async function copy(value: string, label = 'Copied to clipboard'): Promise<boolean> {
    if (value === '') {
      toast.error('Nothing to copy.')
      return false
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        legacyCopy(value)
      }
      toast.success(label)
      return true
    } catch {
      try {
        legacyCopy(value)
        toast.success(label)
        return true
      } catch {
        toast.error('The browser blocked clipboard access.')
        return false
      }
    }
  }

  async function readText(): Promise<string | null> {
    try {
      return await navigator.clipboard.readText()
    } catch {
      toast.error('Clipboard read was blocked - use Ctrl/Cmd+V instead.')
      return null
    }
  }

  return { copy, readText }
}

function legacyCopy(value: string): void {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  downloadBlob(filename, new Blob([content], { type: `${mime};charset=utf-8` }))
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  triggerDownload(filename, url)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  triggerDownload(filename, dataUrl)
}

function triggerDownload(filename: string, href: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}
