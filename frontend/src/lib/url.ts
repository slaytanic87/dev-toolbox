/**
 * URL encoding / decoding plus structural URL inspection.
 */

export type UrlEncodeMode = 'component' | 'uri' | 'form'

export interface UrlQueryParam {
  key: string
  value: string
}

export interface UrlBreakdown {
  protocol: string
  username: string
  password: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  origin: string
  params: UrlQueryParam[]
}

export function encodeUrl(text: string, mode: UrlEncodeMode = 'component'): string {
  switch (mode) {
    case 'uri':
      return encodeURI(text)
    case 'form':
      return encodeURIComponent(text).replace(/%20/g, '+')
    default:
      return encodeURIComponent(text)
  }
}

export function decodeUrl(text: string, mode: UrlEncodeMode = 'component'): string {
  const prepared = mode === 'form' ? text.replace(/\+/g, ' ') : text
  try {
    return mode === 'uri' ? decodeURI(prepared) : decodeURIComponent(prepared)
  } catch {
    throw new Error('Malformed percent-encoding (e.g. a stray "%" or an incomplete "%XX" escape).')
  }
}

/** Decodes repeatedly until the value stops changing - useful for double encoded URLs. */
export function decodeUrlDeep(text: string, maxRounds = 5): { value: string; rounds: number } {
  let value = text
  let rounds = 0
  for (let i = 0; i < maxRounds; i++) {
    let next: string
    try {
      next = decodeURIComponent(value.replace(/\+/g, ' '))
    } catch {
      break
    }
    if (next === value) break
    value = next
    rounds++
  }
  return { value, rounds }
}

export function parseUrl(input: string): UrlBreakdown {
  const url = new URL(input.trim())
  const params: UrlQueryParam[] = []
  url.searchParams.forEach((value, key) => params.push({ key, value }))

  return {
    protocol: url.protocol.replace(/:$/, ''),
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
    params,
  }
}

export function buildQueryString(params: UrlQueryParam[]): string {
  const search = new URLSearchParams()
  for (const { key, value } of params) {
    if (key.trim() === '') continue
    search.append(key, value)
  }
  return search.toString()
}

export const SAMPLE_URL =
  'https://api.example.com/v1/search?q=hello%20world&tags=a%2Cb&redirect=https%3A%2F%2Fexample.com%2Fok#results'
