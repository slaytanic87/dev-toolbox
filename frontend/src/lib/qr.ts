/**
 * QR code generation (`qrcode`) and decoding (`jsqr`) - both run in the browser.
 */

import jsQR from 'jsqr'
import QRCode from 'qrcode'
import type { QRCodeErrorCorrectionLevel } from 'qrcode'

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrRenderOptions {
  errorCorrectionLevel: ErrorCorrectionLevel
  margin: number
  scale: number
  dark: string
  light: string
}

export const DEFAULT_QR_OPTIONS: QrRenderOptions = {
  errorCorrectionLevel: 'M',
  margin: 2,
  scale: 8,
  dark: '#04070a',
  light: '#00ff9c',
}

export const ERROR_CORRECTION_LEVELS: Array<{ value: ErrorCorrectionLevel; label: string }> = [
  { value: 'L', label: 'L - 7% recovery' },
  { value: 'M', label: 'M - 15% recovery' },
  { value: 'Q', label: 'Q - 25% recovery' },
  { value: 'H', label: 'H - 30% recovery' },
]

export async function renderQrToDataUrl(text: string, options: QrRenderOptions): Promise<string> {
  if (text === '') throw new Error('Nothing to encode - the payload is empty.')
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: options.errorCorrectionLevel as QRCodeErrorCorrectionLevel,
    margin: options.margin,
    scale: options.scale,
    color: { dark: options.light, light: options.dark },
  })
}

export async function renderQrToSvg(text: string, options: QrRenderOptions): Promise<string> {
  if (text === '') throw new Error('Nothing to encode - the payload is empty.')
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: options.errorCorrectionLevel as QRCodeErrorCorrectionLevel,
    margin: options.margin,
    color: { dark: options.light, light: options.dark },
  })
}

/* ---------------------------------------------------------------- decoding */

export interface QrDecodeResult {
  text: string
  width: number
  height: number
  corners: Array<{ x: number; y: number }>
}

export async function decodeQrFromImageSource(source: Blob | string): Promise<QrDecodeResult> {
  const image = await loadImage(source)
  const { data, width, height } = toImageData(image)

  // Retry inverted: light-on-dark codes (like the ones this tool renders) need it.
  const decoded =
    jsQR(data, width, height, { inversionAttempts: 'attemptBoth' }) ??
    jsQR(toGrayscaleBoosted(data), width, height, { inversionAttempts: 'attemptBoth' })

  if (!decoded) {
    throw new Error('No QR code found in the image. Try a sharper crop or higher contrast.')
  }
  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = decoded.location
  return {
    text: decoded.data,
    width,
    height,
    corners: [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner],
  }
}

function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(url)
      reject(new Error('The file could not be read as an image.'))
    }
    image.src = url
  })
}

function toImageData(image: HTMLImageElement): ImageData {
  // Upscale small codes a little - jsQR is more reliable above ~300px.
  const scale = Math.min(4, Math.max(1, Math.ceil(320 / Math.max(image.width, image.height))))
  const width = image.width * scale
  const height = image.height * scale

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D context is unavailable in this browser.')
  context.imageSmoothingEnabled = false
  context.drawImage(image, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

/** Hard black/white threshold - rescues low contrast or coloured QR codes. */
function toGrayscaleBoosted(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const luminance =
      0.299 * (data[i] as number) + 0.587 * (data[i + 1] as number) + 0.114 * (data[i + 2] as number)
    const value = luminance > 128 ? 255 : 0
    out[i] = value
    out[i + 1] = value
    out[i + 2] = value
    out[i + 3] = 255
  }
  return out
}

/* ------------------------------------------------------------- QR payloads */

export interface QrPayloadTemplate {
  id: string
  label: string
  build: (values: Record<string, string>) => string
  fields: Array<{ key: string; label: string; placeholder?: string }>
}

const escapeMecard = (value: string): string => value.replace(/([\\;:,])/g, '\\$1')

export const QR_TEMPLATES: QrPayloadTemplate[] = [
  {
    id: 'text',
    label: 'Plain text / URL',
    fields: [{ key: 'text', label: 'Content', placeholder: 'https://example.com' }],
    build: (v) => v['text'] ?? '',
  },
  {
    id: 'wifi',
    label: 'Wi-Fi network',
    fields: [
      { key: 'ssid', label: 'SSID', placeholder: 'MyNetwork' },
      { key: 'password', label: 'Password', placeholder: 'secret' },
      { key: 'type', label: 'Security (WPA/WEP/nopass)', placeholder: 'WPA' },
    ],
    build: (v) =>
      `WIFI:T:${v['type'] || 'WPA'};S:${escapeMecard(v['ssid'] ?? '')};P:${escapeMecard(v['password'] ?? '')};;`,
  },
  {
    id: 'mailto',
    label: 'E-mail',
    fields: [
      { key: 'to', label: 'To', placeholder: 'dev@example.com' },
      { key: 'subject', label: 'Subject' },
      { key: 'body', label: 'Body' },
    ],
    build: (v) => {
      const query = new URLSearchParams()
      if (v['subject']) query.set('subject', v['subject'])
      if (v['body']) query.set('body', v['body'])
      const search = query.toString()
      return `mailto:${v['to'] ?? ''}${search ? `?${search}` : ''}`
    },
  },
  {
    id: 'vcard',
    label: 'Contact (MECARD)',
    fields: [
      { key: 'name', label: 'Name', placeholder: 'Doe,John' },
      { key: 'tel', label: 'Phone', placeholder: '+49123456789' },
      { key: 'email', label: 'E-mail' },
    ],
    build: (v) =>
      `MECARD:N:${escapeMecard(v['name'] ?? '')};TEL:${escapeMecard(v['tel'] ?? '')};EMAIL:${escapeMecard(v['email'] ?? '')};;`,
  },
  {
    id: 'otp',
    label: 'TOTP (2FA)',
    fields: [
      { key: 'label', label: 'Account label', placeholder: 'DevToolbox:dev@example.com' },
      { key: 'secret', label: 'Base32 secret', placeholder: 'JBSWY3DPEHPK3PXP' },
      { key: 'issuer', label: 'Issuer', placeholder: 'DevToolbox' },
    ],
    build: (v) =>
      `otpauth://totp/${encodeURIComponent(v['label'] ?? '')}?secret=${v['secret'] ?? ''}&issuer=${encodeURIComponent(v['issuer'] ?? '')}`,
  },
]
