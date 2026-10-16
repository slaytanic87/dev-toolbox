/**
 * JSON formatting, validation and inspection helpers.
 */

export interface JsonError {
  message: string
  line: number
  column: number
  position: number
}

export interface JsonStats {
  objects: number
  arrays: number
  strings: number
  numbers: number
  booleans: number
  nulls: number
  maxDepth: number
  nodes: number
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue
}

/** Turns a `SyntaxError` from `JSON.parse` into a line/column aware error. */
export function toJsonError(error: unknown, source: string): JsonError {
  const message = error instanceof Error ? error.message : String(error)
  const position = extractPosition(message, source)
  const upTo = source.slice(0, Math.max(position, 0))
  const lines = upTo.split('\n')
  return {
    message: message.replace(/^JSON\.parse:\s*/, '').replace(/\s+at position \d+.*$/, ''),
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    position: Math.max(position, 0),
  }
}

function extractPosition(message: string, source: string): number {
  const byPosition = /position (\d+)/i.exec(message)
  if (byPosition?.[1]) return Math.min(Number(byPosition[1]), source.length)

  const byLineColumn = /line (\d+) column (\d+)/i.exec(message)
  if (byLineColumn?.[1] && byLineColumn[2]) {
    const line = Number(byLineColumn[1])
    const column = Number(byLineColumn[2])
    const lines = source.split('\n')
    let offset = 0
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += (lines[i]?.length ?? 0) + 1
    return offset + column - 1
  }
  return 0
}

export function formatJson(text: string, indent: number | '\t' = 2, sortKeys = false): string {
  const value = parseJson(text)
  return JSON.stringify(sortKeys ? sortJsonKeys(value) : value, null, indent)
}

export function minifyJson(text: string): string {
  return JSON.stringify(parseJson(text))
}

export function sortJsonKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJsonKeys)
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, JsonValue>>((acc, key) => {
        acc[key] = sortJsonKeys((value as Record<string, JsonValue>)[key] as JsonValue)
        return acc
      }, {})
  }
  return value
}

export function analyseJson(value: JsonValue): JsonStats {
  const stats: JsonStats = {
    objects: 0,
    arrays: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    maxDepth: 0,
    nodes: 0,
  }

  const walk = (node: JsonValue, depth: number): void => {
    stats.nodes++
    stats.maxDepth = Math.max(stats.maxDepth, depth)
    if (node === null) {
      stats.nulls++
    } else if (Array.isArray(node)) {
      stats.arrays++
      for (const item of node) walk(item, depth + 1)
    } else {
      switch (typeof node) {
        case 'object':
          stats.objects++
          for (const item of Object.values(node)) walk(item, depth + 1)
          break
        case 'string':
          stats.strings++
          break
        case 'number':
          stats.numbers++
          break
        case 'boolean':
          stats.booleans++
          break
      }
    }
  }

  walk(value, 1)
  return stats
}

/**
 * Minimal, dependency free JSONPath-ish accessor.
 * Supports `$.a.b[0]`, `a.b`, `$["key with space"]` and `[*]` wildcards.
 */
export function queryJson(value: JsonValue, path: string): JsonValue[] {
  const trimmed = path.trim().replace(/^\$\.?/, '')
  if (trimmed === '') return [value]

  const tokens = trimmed.match(/[^.[\]"']+|\[\s*\*\s*\]|\[\s*\d+\s*\]/g) ?? []
  let current: JsonValue[] = [value]

  for (const rawToken of tokens) {
    const token = rawToken.trim()
    const next: JsonValue[] = []
    for (const node of current) {
      if (node === null || typeof node !== 'object') continue
      if (token === '[*]' || token === '*') {
        next.push(...(Array.isArray(node) ? node : Object.values(node)))
      } else if (/^\[\d+\]$/.test(token)) {
        const index = Number(token.slice(1, -1))
        if (Array.isArray(node) && index < node.length) next.push(node[index] as JsonValue)
      } else if (Array.isArray(node)) {
        const index = Number(token)
        if (Number.isInteger(index) && index < node.length) next.push(node[index] as JsonValue)
      } else if (token in node) {
        next.push((node as Record<string, JsonValue>)[token] as JsonValue)
      }
    }
    current = next
    if (current.length === 0) break
  }
  return current
}

export const SAMPLE_JSON = `{
  "service": "devtoolbox",
  "version": "1.0.0",
  "offline": true,
  "tools": ["qr", "jwt", "url", "json", "base64", "regex", "uuid", "rest"],
  "limits": { "requestsPerMinute": 120, "maxPayloadKb": 512 },
  "maintainer": null
}`
