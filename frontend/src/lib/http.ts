/**
 * Browser-only HTTP client used by the REST tester.
 * Requests go straight from the browser, so the usual CORS rules apply.
 */

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

export type BodyMode = 'none' | 'json' | 'text' | 'form' | 'urlencoded'

export type AuthMode = 'none' | 'bearer' | 'basic' | 'apiKey'

export interface KeyValueEntry {
  id: string
  enabled: boolean
  key: string
  value: string
}

export interface AuthConfig {
  mode: AuthMode
  token: string
  username: string
  password: string
  apiKeyName: string
  apiKeyValue: string
  apiKeyIn: 'header' | 'query'
}

export interface HttpRequestConfig {
  method: HttpMethod
  url: string
  params: KeyValueEntry[]
  headers: KeyValueEntry[]
  bodyMode: BodyMode
  body: string
  formFields: KeyValueEntry[]
  auth: AuthConfig
  timeoutMs: number
  followRedirects: boolean
  withCredentials: boolean
}

export interface HttpResponseResult {
  ok: boolean
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
  contentType: string
  size: number
  durationMs: number
  redirected: boolean
  finalUrl: string
  isBinary: boolean
  blobUrl?: string
}

export function createEntry(key = '', value = ''): KeyValueEntry {
  return { id: crypto.randomUUID(), enabled: true, key, value }
}

export function createDefaultAuth(): AuthConfig {
  return {
    mode: 'none',
    token: '',
    username: '',
    password: '',
    apiKeyName: 'X-API-Key',
    apiKeyValue: '',
    apiKeyIn: 'header',
  }
}

export function createDefaultRequest(): HttpRequestConfig {
  return {
    method: 'GET',
    url: 'https://httpbin.org/get',
    params: [createEntry()],
    headers: [createEntry('Accept', 'application/json')],
    bodyMode: 'none',
    body: '',
    formFields: [createEntry()],
    auth: createDefaultAuth(),
    timeoutMs: 30_000,
    followRedirects: true,
    withCredentials: false,
  }
}

const activeEntries = (entries: KeyValueEntry[]): KeyValueEntry[] =>
  entries.filter((entry) => entry.enabled && entry.key.trim() !== '')

export function buildRequestUrl(config: HttpRequestConfig): string {
  const url = new URL(config.url.trim())
  for (const { key, value } of activeEntries(config.params)) url.searchParams.append(key, value)
  return url.toString()
}

const CONTENT_TYPE_BY_MODE: Partial<Record<BodyMode, string>> = {
  json: 'application/json',
  text: 'text/plain;charset=UTF-8',
  urlencoded: 'application/x-www-form-urlencoded;charset=UTF-8',
}


export function buildRequestInit(config: HttpRequestConfig, signal: AbortSignal): RequestInit {
  const headers = new Headers()
  for (const { key, value } of activeEntries(config.headers)) headers.set(key, value)

  return {
    method: config.method,
    headers,
    body: config.body,
    signal,
    redirect: config.followRedirects ? 'follow' : 'manual',
    credentials: config.withCredentials ? 'include' : 'same-origin',
  }
}

const TEXTUAL =
  /^(text\/|image\/svg\+xml|application\/(json|xml|javascript|graphql|x-ndjson|x-www-form-urlencoded|[\w.-]*\+json|[\w.-]*\+xml))/i

export async function sendHttpRequest(
  config: HttpRequestConfig,
  externalSignal?: AbortSignal,
): Promise<HttpResponseResult> {
  const url = buildRequestUrl(config)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), Math.max(1000, config.timeoutMs))
  externalSignal?.addEventListener('abort', () => controller.abort(), { once: true })

  const started = performance.now()
  try {
    const response = await fetch(url, buildRequestInit(config, controller.signal))
    const blob = await response.blob()
    const contentType = response.headers.get('content-type') ?? blob.type ?? ''
    const isBinary = !TEXTUAL.test(contentType) && contentType !== ''

    const result: HttpResponseResult = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: isBinary ? '' : await blob.text(),
      contentType,
      size: blob.size,
      durationMs: performance.now() - started,
      redirected: response.redirected,
      finalUrl: response.url || url,
      isBinary,
    }
    if (isBinary) result.blobUrl = URL.createObjectURL(blob)
    return result
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Request aborted after ${Math.round(performance.now() - started)} ms.`)
    }
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} - this is usually a CORS ` +
        'restriction, an unreachable host or a mixed-content block. Check the browser console.',
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

/* ----------------------------------------------------------------- export */

export function toCurl(config: HttpRequestConfig): string {
  const lines = [`curl -X ${config.method} '${safeUrl(config)}'`]

  for (const { key, value } of activeEntries(config.headers)) {
    lines.push(`  -H '${key}: ${value}'`)
  }
  if (config.auth.mode === 'bearer' && config.auth.token) {
    lines.push(`  -H 'Authorization: Bearer ${config.auth.token}'`)
  }
  if (config.auth.mode === 'basic') {
    lines.push(`  -u '${config.auth.username}:${config.auth.password}'`)
  }
  if (config.auth.mode === 'apiKey' && config.auth.apiKeyIn === 'header') {
    lines.push(`  -H '${config.auth.apiKeyName}: ${config.auth.apiKeyValue}'`)
  }

  if (config.method !== 'GET' && config.method !== 'HEAD' && config.bodyMode !== 'none') {
    if (config.bodyMode === 'form') {
      for (const { key, value } of activeEntries(config.formFields)) {
        lines.push(`  -F '${key}=${value}'`)
      }
    } else if (config.bodyMode === 'urlencoded') {
      for (const { key, value } of activeEntries(config.formFields)) {
        lines.push(`  --data-urlencode '${key}=${value}'`)
      }
    } else {
      const contentType = CONTENT_TYPE_BY_MODE[config.bodyMode]
      if (contentType) lines.push(`  -H 'Content-Type: ${contentType}'`)
      lines.push(`  -d '${config.body.replace(/'/g, `'\\''`)}'`)
    }
  }
  return lines.join(' \\\n')
}

function safeUrl(config: HttpRequestConfig): string {
  try {
    return buildRequestUrl(config)
  } catch {
    return config.url
  }
}

export function statusTone(status: number): 'ok' | 'warn' | 'danger' | 'muted' {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 400) return 'warn'
  if (status >= 400) return 'danger'
  return 'muted'
}
