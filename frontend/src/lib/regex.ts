/**
 * Regular expression evaluation helpers used by the regex playground.
 */

export interface RegexGroup {
  index: number
  name?: string
  value: string | undefined
  start: number
  end: number
}

export interface RegexMatch {
  index: number
  start: number
  end: number
  value: string
  groups: RegexGroup[]
}

export interface RegexRunResult {
  matches: RegexMatch[]
  error: string | null
  truncated: boolean
  durationMs: number
}

export const REGEX_FLAGS = [
  { flag: 'g', label: 'global', hint: 'Find all matches instead of stopping at the first.' },
  { flag: 'i', label: 'ignore case', hint: 'Case insensitive matching.' },
  { flag: 'm', label: 'multiline', hint: '^ and $ match at line breaks.' },
  { flag: 's', label: 'dot all', hint: '. also matches newline characters.' },
  { flag: 'u', label: 'unicode', hint: 'Enable full unicode and \\p{...} escapes.' },
  { flag: 'y', label: 'sticky', hint: 'Match only from lastIndex onwards.' },
  { flag: 'd', label: 'indices', hint: 'Expose start/end offsets for capture groups.' },
] as const

const MAX_MATCHES = 2000

export function buildRegex(pattern: string, flags: string): RegExp {
  // `d` gives us per-group indices which power the group highlighting.
  const effective = flags.includes('d') ? flags : `${flags}d`
  return new RegExp(pattern, effective)
}

export function runRegex(pattern: string, flags: string, input: string): RegexRunResult {
  const result: RegexRunResult = { matches: [], error: null, truncated: false, durationMs: 0 }
  if (pattern === '') return result

  let regex: RegExp
  try {
    regex = buildRegex(pattern, flags)
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    return result
  }

  const started = performance.now()
  try {
    if (!regex.global && !regex.sticky) {
      const match = regex.exec(input)
      if (match) result.matches.push(toMatch(match, 0))
    } else {
      let match: RegExpExecArray | null
      let counter = 0
      while ((match = regex.exec(input)) !== null) {
        result.matches.push(toMatch(match, counter++))
        // Guard against endless loops on zero-length matches.
        if (match[0] === '') regex.lastIndex++
        if (counter >= MAX_MATCHES) {
          result.truncated = true
          break
        }
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  result.durationMs = performance.now() - started
  return result
}

function toMatch(match: RegExpExecArray, index: number): RegexMatch {
  const start = match.index
  const end = start + match[0].length
  const indices = (match as RegExpExecArray & { indices?: Array<[number, number] | undefined> })
    .indices
  const namedIndices = (
    match as RegExpExecArray & { indices?: { groups?: Record<string, [number, number] | undefined> } }
  ).indices?.groups

  const nameByIndex = new Map<number, string>()
  if (match.groups && namedIndices) {
    for (const [name, range] of Object.entries(namedIndices)) {
      if (!range || !indices) continue
      const position = indices.findIndex((i) => i && i[0] === range[0] && i[1] === range[1])
      if (position > 0) nameByIndex.set(position, name)
    }
  }

  const groups: RegexGroup[] = []
  for (let i = 1; i < match.length; i++) {
    const range = indices?.[i]
    const group: RegexGroup = {
      index: i,
      value: match[i],
      start: range?.[0] ?? -1,
      end: range?.[1] ?? -1,
    }
    const name = nameByIndex.get(i)
    if (name) group.name = name
    groups.push(group)
  }

  return { index, start, end, value: match[0], groups }
}

export function replaceWithRegex(
  pattern: string,
  flags: string,
  input: string,
  replacement: string,
): { value: string; error: string | null } {
  if (pattern === '') return { value: input, error: null }
  try {
    const regex = buildRegex(pattern, flags)
    return { value: input.replace(regex, replacement), error: null }
  } catch (error) {
    return { value: '', error: error instanceof Error ? error.message : String(error) }
  }
}

export function splitWithRegex(
  pattern: string,
  flags: string,
  input: string,
): { parts: string[]; error: string | null } {
  if (pattern === '') return { parts: [input], error: null }
  try {
    return { parts: input.split(buildRegex(pattern, flags)), error: null }
  } catch (error) {
    return { parts: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/* --------------------------------------------------------- explain tokens */

interface TokenRule {
  pattern: RegExp
  describe: (match: RegExpExecArray) => string
}

const TOKEN_RULES: TokenRule[] = [
  { pattern: /^\\[dDwWsSbBnrtfv0]/, describe: (m) => escapeDescription(m[0]) },
  { pattern: /^\\[pP]\{[^}]+\}/, describe: (m) => `unicode property ${m[0]}` },
  { pattern: /^\\u\{[0-9a-fA-F]+\}|^\\u[0-9a-fA-F]{4}|^\\x[0-9a-fA-F]{2}/, describe: (m) => `code point ${m[0]}` },
  { pattern: /^\\\d+/, describe: (m) => `back-reference to group ${m[0].slice(1)}` },
  { pattern: /^\\k<[^>]+>/, describe: (m) => `back-reference to named group "${m[0].slice(3, -1)}"` },
  { pattern: /^\\./, describe: (m) => `literal "${m[0][1]}"` },
  { pattern: /^\(\?<[=!]/, describe: (m) => (m[0].endsWith('=') ? 'lookbehind (must precede)' : 'negative lookbehind') },
  { pattern: /^\(\?<[^>]+>/, describe: (m) => `named capture group "${m[0].slice(3, -1)}"` },
  { pattern: /^\(\?[=!]/, describe: (m) => (m[0].endsWith('=') ? 'lookahead (must follow)' : 'negative lookahead') },
  { pattern: /^\(\?:/, describe: () => 'non-capturing group' },
  { pattern: /^\(/, describe: () => 'start of capture group' },
  { pattern: /^\)/, describe: () => 'end of group' },
  { pattern: /^\[\^[^\]]*\]/, describe: (m) => `any character NOT in ${m[0]}` },
  { pattern: /^\[[^\]]*\]/, describe: (m) => `any character in ${m[0]}` },
  { pattern: /^\{\d+,\d+\}/, describe: (m) => `repeat ${m[0].slice(1, -1).replace(',', ' to ')} times` },
  { pattern: /^\{\d+,\}/, describe: (m) => `repeat at least ${m[0].slice(1, -2)} times` },
  { pattern: /^\{\d+\}/, describe: (m) => `repeat exactly ${m[0].slice(1, -1)} times` },
  { pattern: /^[*+?]\?/, describe: (m) => `${quantifier(m[0][0] as string)} (lazy)` },
  { pattern: /^[*+?]/, describe: (m) => `${quantifier(m[0])} (greedy)` },
  { pattern: /^\^/, describe: () => 'start of string / line' },
  { pattern: /^\$/, describe: () => 'end of string / line' },
  { pattern: /^\./, describe: () => 'any character (except newline unless /s)' },
  { pattern: /^\|/, describe: () => 'alternation (OR)' },
]

function quantifier(symbol: string): string {
  if (symbol === '*') return 'repeat 0 or more times'
  if (symbol === '+') return 'repeat 1 or more times'
  return 'optional (0 or 1 time)'
}

function escapeDescription(token: string): string {
  const map: Record<string, string> = {
    '\\d': 'any digit [0-9]',
    '\\D': 'any non-digit',
    '\\w': 'any word character [A-Za-z0-9_]',
    '\\W': 'any non-word character',
    '\\s': 'any whitespace',
    '\\S': 'any non-whitespace',
    '\\b': 'word boundary',
    '\\B': 'non word boundary',
    '\\n': 'newline',
    '\\r': 'carriage return',
    '\\t': 'tab',
    '\\f': 'form feed',
    '\\v': 'vertical tab',
    '\\0': 'NUL character',
  }
  return map[token] ?? `escape ${token}`
}

export interface ExplainedToken {
  token: string
  description: string
}

/** Best-effort, human readable breakdown of a pattern (not a full parser). */
export function explainPattern(pattern: string): ExplainedToken[] {
  const tokens: ExplainedToken[] = []
  let rest = pattern

  while (rest.length > 0) {
    const rule = TOKEN_RULES.find((candidate) => candidate.pattern.test(rest))
    if (rule) {
      const match = rule.pattern.exec(rest) as RegExpExecArray
      tokens.push({ token: match[0], description: rule.describe(match) })
      rest = rest.slice(match[0].length)
      continue
    }
    const literal = /^[^\\^$.|?*+()[\]{}]+/.exec(rest)
    if (literal) {
      tokens.push({ token: literal[0], description: `literal text "${literal[0]}"` })
      rest = rest.slice(literal[0].length)
      continue
    }
    tokens.push({ token: rest[0] as string, description: `literal "${rest[0]}"` })
    rest = rest.slice(1)
  }
  return tokens
}

/* ------------------------------------------------------------- cheat sheet */

export const REGEX_CHEATSHEET: Array<{ group: string; items: Array<[string, string]> }> = [
  {
    group: 'Character classes',
    items: [
      ['.', 'any character except newline'],
      ['\\w \\d \\s', 'word, digit, whitespace'],
      ['\\W \\D \\S', 'not word, digit, whitespace'],
      ['[abc]', 'any of a, b or c'],
      ['[^abc]', 'not a, b or c'],
      ['[a-g]', 'character between a and g'],
    ],
  },
  {
    group: 'Anchors',
    items: [
      ['^abc$', 'start / end of the string'],
      ['\\b \\B', 'word, not-word boundary'],
    ],
  },
  {
    group: 'Quantifiers',
    items: [
      ['a* a+ a?', '0+, 1+, 0 or 1'],
      ['a{5} a{2,}', 'exactly five, two or more'],
      ['a{1,3}', 'between one and three'],
      ['a+? a{2,}?', 'match as few as possible'],
    ],
  },
  {
    group: 'Groups & lookaround',
    items: [
      ['(abc)', 'capture group'],
      ['(?:abc)', 'non-capturing group'],
      ['(?<name>abc)', 'named capture group'],
      ['(?=abc) (?!abc)', 'positive / negative lookahead'],
      ['(?<=abc) (?<!abc)', 'positive / negative lookbehind'],
    ],
  },
  {
    group: 'Substitution',
    items: [
      ['$1 $2', 'nth capture group'],
      ['$<name>', 'named capture group'],
      ['$& $` $\'', 'whole match, before, after'],
    ],
  },
]

export const SAMPLE_PATTERN = '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]{2,})'

export const SAMPLE_TEST_TEXT = `Contact list export
-------------------
ada.lovelace@example.com      (engineering)
grace+hopper@navy.example.org (ops)
not-an-email@localhost
turing@cam.ac.uk              (research)
`
