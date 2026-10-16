/**
 * Text encodings for the hex editor's character column, the text search and
 * the "compare encodings" panel.
 *
 * Single byte code pages are expanded into a 256 entry lookup table once and
 * cached, which also gives us a byte-exact inverse table for encoding text
 * back to bytes. Multi byte encodings are decoded byte by byte through a
 * streaming `TextDecoder`, so every character can be attached to the cell its
 * sequence starts in (continuation cells come back as an empty string).
 */

export type EncodingGroup =
  | 'Unicode'
  | 'Western'
  | 'Central European'
  | 'Cyrillic'
  | 'Greek & Turkish'
  | 'Nordic & Baltic'
  | 'Other'
  | 'East Asian'
  | 'Legacy'

export interface EncodingInfo {
  id: string
  label: string
  group: EncodingGroup
  /** Characters may span several bytes. */
  multiByte: boolean
  /** Text can be turned back into bytes with this encoding. */
  encodable: boolean
}

/** Shown for bytes that are not printable in the selected encoding. */
export const DEFAULT_PLACEHOLDER = '.'
/** Shown for the trailing bytes of a multi byte character. */
export const CONTINUATION_CHAR = '\u00b7'

const MULTI_BYTE = new Set([
  'utf-8',
  'utf-16le',
  'utf-16be',
  'gbk',
  'gb18030',
  'big5',
  'euc-jp',
  'iso-2022-jp',
  'shift_jis',
  'euc-kr',
])

export const ENCODINGS: EncodingInfo[] = [
  entry('ascii', 'US-ASCII (7 bit)', 'Unicode'),
  entry('utf-8', 'UTF-8', 'Unicode'),
  entry('utf-16le', 'UTF-16 LE', 'Unicode'),
  entry('utf-16be', 'UTF-16 BE', 'Unicode'),
  entry('latin1', 'ISO-8859-1 (Latin-1)', 'Western'),
  entry('windows-1252', 'Windows-1252', 'Western'),
  entry('iso-8859-15', 'ISO-8859-15 (Latin-9)', 'Western'),
  entry('iso-8859-3', 'ISO-8859-3 (South European)', 'Western'),
  entry('macintosh', 'Mac Roman', 'Western'),
  entry('iso-8859-2', 'ISO-8859-2 (Latin-2)', 'Central European'),
  entry('windows-1250', 'Windows-1250', 'Central European'),
  entry('iso-8859-16', 'ISO-8859-16 (Latin-10)', 'Central European'),
  entry('iso-8859-5', 'ISO-8859-5 (Cyrillic)', 'Cyrillic'),
  entry('windows-1251', 'Windows-1251', 'Cyrillic'),
  entry('koi8-r', 'KOI8-R', 'Cyrillic'),
  entry('koi8-u', 'KOI8-U', 'Cyrillic'),
  entry('ibm866', 'IBM866 (DOS Cyrillic)', 'Cyrillic'),
  entry('x-mac-cyrillic', 'Mac Cyrillic', 'Cyrillic'),
  entry('iso-8859-7', 'ISO-8859-7 (Greek)', 'Greek & Turkish'),
  entry('windows-1253', 'Windows-1253 (Greek)', 'Greek & Turkish'),
  entry('iso-8859-9', 'ISO-8859-9 (Turkish)', 'Greek & Turkish'),
  entry('windows-1254', 'Windows-1254 (Turkish)', 'Greek & Turkish'),
  entry('iso-8859-4', 'ISO-8859-4 (Baltic)', 'Nordic & Baltic'),
  entry('iso-8859-10', 'ISO-8859-10 (Nordic)', 'Nordic & Baltic'),
  entry('iso-8859-13', 'ISO-8859-13 (Baltic)', 'Nordic & Baltic'),
  entry('iso-8859-14', 'ISO-8859-14 (Celtic)', 'Nordic & Baltic'),
  entry('windows-1257', 'Windows-1257 (Baltic)', 'Nordic & Baltic'),
  entry('iso-8859-6', 'ISO-8859-6 (Arabic)', 'Other'),
  entry('windows-1256', 'Windows-1256 (Arabic)', 'Other'),
  entry('iso-8859-8', 'ISO-8859-8 (Hebrew)', 'Other'),
  entry('iso-8859-8-i', 'ISO-8859-8-I (Hebrew)', 'Other'),
  entry('windows-1255', 'Windows-1255 (Hebrew)', 'Other'),
  entry('windows-1258', 'Windows-1258 (Vietnamese)', 'Other'),
  entry('windows-874', 'Windows-874 (Thai)', 'Other'),
  entry('shift_jis', 'Shift_JIS', 'East Asian'),
  entry('euc-jp', 'EUC-JP', 'East Asian'),
  entry('iso-2022-jp', 'ISO-2022-JP', 'East Asian'),
  entry('euc-kr', 'EUC-KR', 'East Asian'),
  entry('gbk', 'GBK', 'East Asian'),
  entry('gb18030', 'GB18030', 'East Asian'),
  entry('big5', 'Big5', 'East Asian'),
  entry('ibm437', 'IBM437 (DOS US)', 'Legacy'),
  entry('ebcdic-037', 'EBCDIC (IBM-037)', 'Legacy'),
  entry('ebcdic-500', 'EBCDIC (IBM-500)', 'Legacy'),
]

function entry(id: string, label: string, group: EncodingGroup): EncodingInfo {
  const multiByte = MULTI_BYTE.has(id)
  return {
    id,
    label,
    group,
    multiByte,
    // Everything single byte is invertible, UTF-8/16 we encode ourselves.
    encodable: !multiByte || id === 'utf-8' || id === 'utf-16le' || id === 'utf-16be',
  }
}

export const ENCODING_BY_ID = new Map(ENCODINGS.map((item) => [item.id, item]))

export function encodingLabel(id: string): string {
  return ENCODING_BY_ID.get(id)?.label ?? id
}

/* ------------------------------------------------------- custom tables ---- */

/** CP437 including the graphic glyphs DOS used for the control range. */
const IBM437 =
  '\u0000\u263a\u263b\u2665\u2666\u2663\u2660\u2022\u25d8\u25cb\u25d9\u2642\u2640\u266a\u266b\u263c' +
  '\u25ba\u25c4\u2195\u203c\u00b6\u00a7\u25ac\u21a8\u2191\u2193\u2192\u2190\u221f\u2194\u25b2\u25bc' +
  ' !"#$%&\'()*+,-./0123456789:;<=>?' +
  '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_' +
  '`abcdefghijklmnopqrstuvwxyz{|}~\u2302' +
  '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5' +
  '\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192' +
  '\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb' +
  '\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510' +
  '\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567' +
  '\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580' +
  '\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229' +
  '\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0'

/** Builds the EBCDIC tables from their (shared) printable layout. */
function buildEbcdic(variant: '037' | '500'): string[] {
  const table = new Array<string>(256).fill('\u0000')
  const put = (start: number, text: string): void => {
    for (let i = 0; i < text.length; i++) table[start + i] = text[i]!
  }
  put(0x40, ' \u00a0\u00e2\u00e4\u00e0\u00e1\u00e3\u00e5\u00e7\u00f1\u00a2.<(+|')
  put(0x50, '&\u00e9\u00ea\u00eb\u00e8\u00ed\u00ee\u00ef\u00ec\u00df!$*);\u00ac')
  put(0x60, '-/\u00c2\u00c4\u00c0\u00c1\u00c3\u00c5\u00c7\u00d1\u00a6,%_>?')
  put(0x70, '\u00f8\u00c9\u00ca\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc`:#@\'="')
  put(0x80, '\u00d8abcdefghi\u00ab\u00bb\u00f0\u00fd\u00fe\u00b1')
  put(0x90, '\u00b0jklmnopqr\u00aa\u00ba\u00e6\u00b8\u00c6\u00a4')
  put(0xa0, '\u00b5~stuvwxyz\u00a1\u00bf\u00d0\u00dd\u00de\u00ae')
  put(0xb0, '^\u00a3\u00a5\u00b7\u00a9\u00a7\u00b6\u00bc\u00bd\u00be[]\u00af\u00a8\u00b4\u00d7')
  put(0xc0, '{ABCDEFGHI\u00ad\u00f4\u00f6\u00f2\u00f3\u00f5')
  put(0xd0, '}JKLMNOPQR\u00b9\u00fb\u00fc\u00f9\u00fa\u00ff')
  put(0xe0, '\\\u00f7STUVWXYZ\u00b2\u00d4\u00d6\u00d2\u00d3\u00d5')
  put(0xf0, '0123456789\u00b3\u00db\u00dc\u00d9\u00da\u0000')
  if (variant === '500') {
    // IBM-500 differs from IBM-037 in five punctuation positions.
    table[0x4a] = '['
    table[0x4f] = '!'
    table[0x5a] = ']'
    table[0x5f] = '^'
    table[0xb0] = '\u00a2'
    table[0xba] = '\u00ac'
    table[0xbb] = '|'
  }
  return table
}

/* ------------------------------------------------------------- tables ---- */

const tableCache = new Map<string, string[]>()
const inverseCache = new Map<string, Map<string, number>>()

/** 256 entry table for single byte encodings, `null` for multi byte ones. */
export function byteTable(encoding: string): string[] | null {
  if (MULTI_BYTE.has(encoding)) return null
  const cached = tableCache.get(encoding)
  if (cached) return cached

  let table: string[]
  switch (encoding) {
    case 'ascii':
      table = Array.from({ length: 256 }, (_, i) => (i < 0x80 ? String.fromCharCode(i) : '\u0000'))
      break
    case 'latin1':
      table = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i))
      break
    case 'ibm437':
      table = Array.from(IBM437)
      break
    case 'ebcdic-037':
      table = buildEbcdic('037')
      break
    case 'ebcdic-500':
      table = buildEbcdic('500')
      break
    default:
      table = decodeTableWith(encoding)
  }
  tableCache.set(encoding, table)
  return table
}

/** Builds a code page table by asking `TextDecoder` for every byte value. */
function decodeTableWith(encoding: string): string[] {
  const table = new Array<string>(256)
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(encoding)
  } catch {
    return Array.from({ length: 256 }, (_, i) => String.fromCharCode(i))
  }
  const single = new Uint8Array(1)
  for (let i = 0; i < 256; i++) {
    single[0] = i
    const text = decoder.decode(single)
    table[i] = text.length === 1 ? text : '\u0000'
  }
  return table
}

function inverseTable(encoding: string): Map<string, number> | null {
  const cached = inverseCache.get(encoding)
  if (cached) return cached
  const table = byteTable(encoding)
  if (!table) return null
  const inverse = new Map<string, number>()
  for (let i = 255; i >= 0; i--) {
    const char = table[i]!
    if (char !== '\u0000' || i === 0) inverse.set(char, i)
  }
  inverseCache.set(encoding, inverse)
  return inverse
}

/* ------------------------------------------------------------ decoding ---- */

/**
 * Decodes one grid row. The result has exactly one entry per input byte;
 * trailing bytes of a multi byte character come back as an empty string.
 *
 * Rows are decoded independently, so a character split across the row boundary
 * is shown as invalid - the same trade-off every grid based hex editor makes.
 */
export function decodeRow(bytes: Uint8Array, encoding: string): string[] {
  const table = byteTable(encoding)
  if (table) return Array.from(bytes, (byte) => table[byte]!)

  const out = new Array<string>(bytes.length).fill('')
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(encoding, { fatal: false })
  } catch {
    return Array.from(bytes, (byte) => String.fromCharCode(byte))
  }

  const single = new Uint8Array(1)
  let sequenceStart = -1
  for (let i = 0; i < bytes.length; i++) {
    single[0] = bytes[i]!
    if (sequenceStart < 0) sequenceStart = i
    const text = decoder.decode(single, { stream: true })
    if (text !== '') {
      out[sequenceStart] = text
      sequenceStart = -1
    }
  }
  const tail = decoder.decode()
  if (tail !== '' && sequenceStart >= 0) out[sequenceStart] = tail
  return out
}

/** Decodes a whole range as a plain string (used by the encodings compare). */
export function decodeText(bytes: Uint8Array, encoding: string): string {
  const table = byteTable(encoding)
  if (table) {
    let out = ''
    for (const byte of bytes) out += table[byte]!
    return out
  }
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes)
  } catch {
    return ''
  }
}

/** Turns a decoded character into something safe to show in a cell. */
export function displayChar(char: string, placeholder = DEFAULT_PLACEHOLDER): string {
  if (char === '') return CONTINUATION_CHAR
  const code = char.codePointAt(0) ?? 0
  if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return placeholder
  if (code === 0xfffd || code === 0xad) return placeholder
  return char
}

/** `true` when the character can be typed into the text column. */
export function isPrintable(char: string): boolean {
  return displayChar(char) === char
}

/* ------------------------------------------------------------ encoding ---- */

export class EncodingError extends Error {}

/** Encodes text with any of the encodings marked `encodable`. */
export function encodeText(text: string, encoding: string): Uint8Array {
  if (encoding === 'utf-8') return new TextEncoder().encode(text)

  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    const little = encoding === 'utf-16le'
    const units: number[] = []
    for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i))
    const out = new Uint8Array(units.length * 2)
    units.forEach((unit, index) => {
      out[index * 2 + (little ? 0 : 1)] = unit & 0xff
      out[index * 2 + (little ? 1 : 0)] = unit >> 8
    })
    return out
  }

  const inverse = inverseTable(encoding)
  if (!inverse) {
    throw new EncodingError(`${encodingLabel(encoding)} cannot be used to encode text.`)
  }

  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const byte = inverse.get(text[i]!)
    if (byte === undefined) {
      throw new EncodingError(`"${text[i]}" does not exist in ${encodingLabel(encoding)}.`)
    }
    out[i] = byte
  }
  return out
}

/** Encodes a single character, used while typing in the text column. */
export function encodeChar(char: string, encoding: string): Uint8Array | null {
  try {
    const bytes = encodeText(char, encoding)
    return bytes.length === 0 ? null : bytes
  } catch {
    return null
  }
}

/**
 * Builds the case variants of a text pattern, so a case insensitive search can
 * be expressed as a set of allowed bytes per position.
 */
export function encodeCaseVariants(text: string, encoding: string): Uint8Array[] {
  const lower = encodeText(text.toLowerCase(), encoding)
  const upper = encodeText(text.toUpperCase(), encoding)
  return lower.length === upper.length ? [lower, upper] : [lower]
}
