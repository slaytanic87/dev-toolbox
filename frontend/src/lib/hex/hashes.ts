/**
 * Incremental checksums and hashes.
 *
 * Every algorithm is a streaming `Hasher`, so a file is hashed by feeding it
 * the 1 MiB windows the document hands out - a 20 GiB image never needs more
 * than one window in memory. `crypto.subtle` is deliberately not used: it only
 * digests a complete buffer.
 */

export interface Hasher {
  update(bytes: Uint8Array): void
  digest(): string
}

export interface HashAlgorithm {
  id: string
  label: string
  group: 'Checksum' | 'CRC' | 'Cryptographic'
}

/* ----------------------------------------------------------------- CRC ---- */

interface CrcSpec {
  width: 8 | 16 | 32
  poly: number
  init: number
  refIn: boolean
  refOut: boolean
  xorOut: number
}

const CRC_SPECS: Record<string, CrcSpec> = {
  'crc-8': { width: 8, poly: 0x07, init: 0x00, refIn: false, refOut: false, xorOut: 0x00 },
  'crc-8-maxim': { width: 8, poly: 0x31, init: 0x00, refIn: true, refOut: true, xorOut: 0x00 },
  'crc-8-darc': { width: 8, poly: 0x39, init: 0x00, refIn: true, refOut: true, xorOut: 0x00 },
  'crc-8-rohc': { width: 8, poly: 0x07, init: 0xff, refIn: true, refOut: true, xorOut: 0x00 },
  'crc-16-arc': { width: 16, poly: 0x8005, init: 0x0000, refIn: true, refOut: true, xorOut: 0x0000 },
  'crc-16-ccitt-false': {
    width: 16,
    poly: 0x1021,
    init: 0xffff,
    refIn: false,
    refOut: false,
    xorOut: 0x0000,
  },
  'crc-16-xmodem': {
    width: 16,
    poly: 0x1021,
    init: 0x0000,
    refIn: false,
    refOut: false,
    xorOut: 0x0000,
  },
  'crc-16-kermit': {
    width: 16,
    poly: 0x1021,
    init: 0x0000,
    refIn: true,
    refOut: true,
    xorOut: 0x0000,
  },
  'crc-16-modbus': {
    width: 16,
    poly: 0x8005,
    init: 0xffff,
    refIn: true,
    refOut: true,
    xorOut: 0x0000,
  },
  'crc-16-usb': { width: 16, poly: 0x8005, init: 0xffff, refIn: true, refOut: true, xorOut: 0xffff },
  'crc-16-genibus': {
    width: 16,
    poly: 0x1021,
    init: 0xffff,
    refIn: false,
    refOut: false,
    xorOut: 0xffff,
  },
  'crc-16-dnp': { width: 16, poly: 0x3d65, init: 0x0000, refIn: true, refOut: true, xorOut: 0xffff },
  'crc-32': {
    width: 32,
    poly: 0x04c11db7,
    init: 0xffffffff,
    refIn: true,
    refOut: true,
    xorOut: 0xffffffff,
  },
  'crc-32c': {
    width: 32,
    poly: 0x1edc6f41,
    init: 0xffffffff,
    refIn: true,
    refOut: true,
    xorOut: 0xffffffff,
  },
  'crc-32-bzip2': {
    width: 32,
    poly: 0x04c11db7,
    init: 0xffffffff,
    refIn: false,
    refOut: false,
    xorOut: 0xffffffff,
  },
  'crc-32-mpeg-2': {
    width: 32,
    poly: 0x04c11db7,
    init: 0xffffffff,
    refIn: false,
    refOut: false,
    xorOut: 0x00000000,
  },
  'crc-32-posix': {
    width: 32,
    poly: 0x04c11db7,
    init: 0x00000000,
    refIn: false,
    refOut: false,
    xorOut: 0xffffffff,
  },
  'crc-32-jamcrc': {
    width: 32,
    poly: 0x04c11db7,
    init: 0xffffffff,
    refIn: true,
    refOut: true,
    xorOut: 0x00000000,
  },
}

const REVERSED_BYTE = (() => {
  const table = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    let result = 0
    for (let bit = 0; bit < 8; bit++) {
      result = (result << 1) | (value & 1)
      value >>= 1
    }
    table[i] = result
  }
  return table
})()

const crcTables = new Map<string, Uint32Array>()

function crcTable(id: string, spec: CrcSpec): Uint32Array {
  const cached = crcTables.get(id)
  if (cached) return cached

  const top = 1 << (spec.width - 1)
  const mask = spec.width === 32 ? 0xffffffff : (1 << spec.width) - 1
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = (i << (spec.width - 8)) >>> 0
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & top ? ((crc << 1) ^ spec.poly) : crc << 1) >>> 0
    }
    table[i] = (crc & mask) >>> 0
  }
  crcTables.set(id, table)
  return table
}

function reflect(value: number, width: number): number {
  let result = 0
  for (let i = 0; i < width; i++) {
    result = ((result << 1) | ((value >>> i) & 1)) >>> 0
  }
  return result >>> 0
}

class CrcHasher implements Hasher {
  private crc: number
  private readonly table: Uint32Array
  private readonly mask: number
  private readonly shift: number

  constructor(
    id: string,
    private readonly spec: CrcSpec,
  ) {
    this.table = crcTable(id, spec)
    this.mask = spec.width === 32 ? 0xffffffff : (1 << spec.width) - 1
    this.shift = spec.width - 8
    this.crc = (spec.init & this.mask) >>> 0
  }

  update(bytes: Uint8Array): void {
    const { table, mask, shift } = this
    const reflectIn = this.spec.refIn
    let crc = this.crc
    for (let i = 0; i < bytes.length; i++) {
      const byte = reflectIn ? REVERSED_BYTE[bytes[i]!]! : bytes[i]!
      const index = ((crc >>> shift) ^ byte) & 0xff
      crc = (((crc << 8) >>> 0) ^ table[index]!) & mask
      crc = crc >>> 0
    }
    this.crc = crc
  }

  digest(): string {
    let value = this.crc
    if (this.spec.refOut) value = reflect(value, this.spec.width)
    value = ((value ^ this.spec.xorOut) & this.mask) >>> 0
    return value.toString(16).padStart(this.spec.width / 4, '0').toUpperCase()
  }
}

/* ------------------------------------------------------------ checksum ---- */

class Adler32Hasher implements Hasher {
  private a = 1
  private b = 0

  update(bytes: Uint8Array): void {
    let a = this.a
    let b = this.b
    for (let i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]!) % 65521
      b = (b + a) % 65521
    }
    this.a = a
    this.b = b
  }

  digest(): string {
    return (((this.b << 16) | this.a) >>> 0).toString(16).padStart(8, '0').toUpperCase()
  }
}

class SumHasher implements Hasher {
  private sum = 0

  update(bytes: Uint8Array): void {
    let sum = this.sum
    for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i]!) >>> 0
    this.sum = sum
  }

  digest(): string {
    return this.sum.toString(16).padStart(8, '0').toUpperCase()
  }
}

class XorHasher implements Hasher {
  private value = 0

  update(bytes: Uint8Array): void {
    let value = this.value
    for (let i = 0; i < bytes.length; i++) value ^= bytes[i]!
    this.value = value & 0xff
  }

  digest(): string {
    return this.value.toString(16).padStart(2, '0').toUpperCase()
  }
}

/* --------------------------------------------------------- block hashes ---- */

/** Shared 64 byte block buffering for MD5, SHA-1 and SHA-256. */
abstract class BlockHasher implements Hasher {
  protected readonly block: Uint8Array
  protected blockLength = 0
  protected totalLength = 0
  private finished = false
  private result = ''

  constructor(protected readonly blockSize: number) {
    this.block = new Uint8Array(blockSize)
  }

  update(bytes: Uint8Array): void {
    this.totalLength += bytes.length
    let offset = 0
    if (this.blockLength > 0) {
      const take = Math.min(this.blockSize - this.blockLength, bytes.length)
      this.block.set(bytes.subarray(0, take), this.blockLength)
      this.blockLength += take
      offset = take
      if (this.blockLength === this.blockSize) {
        this.compress(this.block, 0)
        this.blockLength = 0
      }
    }
    while (offset + this.blockSize <= bytes.length) {
      this.compress(bytes, offset)
      offset += this.blockSize
    }
    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), 0)
      this.blockLength = bytes.length - offset
    }
  }

  digest(): string {
    if (!this.finished) {
      this.finish()
      this.finished = true
      this.result = this.hex()
    }
    return this.result
  }

  protected abstract compress(data: Uint8Array, offset: number): void
  protected abstract finish(): void
  protected abstract hex(): string
}

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function rotr(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0
}

function toHexBE(words: Uint32Array): string {
  let out = ''
  for (const word of words) out += (word >>> 0).toString(16).padStart(8, '0')
  return out
}

const MD5_K = new Uint32Array(
  Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)),
)
const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

class Md5Hasher extends BlockHasher {
  private state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476])
  private readonly words = new Uint32Array(16)

  constructor() {
    super(64)
  }

  protected compress(data: Uint8Array, offset: number): void {
    const words = this.words
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 4
      words[i] =
        (data[base]! | (data[base + 1]! << 8) | (data[base + 2]! << 16) | (data[base + 3]! << 24)) >>>
        0
    }

    let [a, b, c, d] = [this.state[0]!, this.state[1]!, this.state[2]!, this.state[3]!]
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const temp = d
      d = c
      c = b
      const sum = (a + (f >>> 0) + MD5_K[i]! + words[g]!) >>> 0
      b = (b + rotl(sum, MD5_SHIFTS[i]!)) >>> 0
      a = temp
    }

    this.state[0] = (this.state[0]! + a) >>> 0
    this.state[1] = (this.state[1]! + b) >>> 0
    this.state[2] = (this.state[2]! + c) >>> 0
    this.state[3] = (this.state[3]! + d) >>> 0
  }

  protected finish(): void {
    const bitLength = this.totalLength * 8
    const padded = new Uint8Array(this.blockLength < 56 ? 64 : 128)
    padded.set(this.block.subarray(0, this.blockLength))
    padded[this.blockLength] = 0x80
    const dv = new DataView(padded.buffer)
    dv.setUint32(padded.length - 8, bitLength >>> 0, true)
    dv.setUint32(padded.length - 4, Math.floor(bitLength / 4294967296), true)
    for (let offset = 0; offset < padded.length; offset += 64) this.compress(padded, offset)
  }

  protected hex(): string {
    let out = ''
    for (const word of this.state) {
      out += (word & 0xff).toString(16).padStart(2, '0')
      out += ((word >>> 8) & 0xff).toString(16).padStart(2, '0')
      out += ((word >>> 16) & 0xff).toString(16).padStart(2, '0')
      out += ((word >>> 24) & 0xff).toString(16).padStart(2, '0')
    }
    return out
  }
}

/** Shared tail padding for the big endian SHA family. */
abstract class ShaHasher extends BlockHasher {
  protected finish(): void {
    const bitLength = this.totalLength * 8
    const padded = new Uint8Array(this.blockLength < 56 ? 64 : 128)
    padded.set(this.block.subarray(0, this.blockLength))
    padded[this.blockLength] = 0x80
    const dv = new DataView(padded.buffer)
    dv.setUint32(padded.length - 8, Math.floor(bitLength / 4294967296), false)
    dv.setUint32(padded.length - 4, bitLength >>> 0, false)
    for (let offset = 0; offset < padded.length; offset += 64) this.compress(padded, offset)
  }
}

class Sha1Hasher extends ShaHasher {
  private state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0])
  private readonly words = new Uint32Array(80)

  constructor() {
    super(64)
  }

  protected compress(data: Uint8Array, offset: number): void {
    const words = this.words
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 4
      words[i] =
        ((data[base]! << 24) | (data[base + 1]! << 16) | (data[base + 2]! << 8) | data[base + 3]!) >>>
        0
    }
    for (let i = 16; i < 80; i++) {
      words[i] = rotl(words[i - 3]! ^ words[i - 8]! ^ words[i - 14]! ^ words[i - 16]!, 1)
    }

    let [a, b, c, d, e] = [
      this.state[0]!,
      this.state[1]!,
      this.state[2]!,
      this.state[3]!,
      this.state[4]!,
    ]
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + words[i]!) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }

    this.state[0] = (this.state[0]! + a) >>> 0
    this.state[1] = (this.state[1]! + b) >>> 0
    this.state[2] = (this.state[2]! + c) >>> 0
    this.state[3] = (this.state[3]! + d) >>> 0
    this.state[4] = (this.state[4]! + e) >>> 0
  }

  protected hex(): string {
    return toHexBE(this.state)
  }
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

class Sha256Hasher extends ShaHasher {
  private state: Uint32Array
  private readonly words = new Uint32Array(64)

  constructor(private readonly truncated = false) {
    super(64)
    this.state = truncated
      ? new Uint32Array([
          0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7,
          0xbefa4fa4,
        ])
      : new Uint32Array([
          0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
          0x5be0cd19,
        ])
  }

  protected compress(data: Uint8Array, offset: number): void {
    const words = this.words
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 4
      words[i] =
        ((data[base]! << 24) | (data[base + 1]! << 16) | (data[base + 2]! << 8) | data[base + 3]!) >>>
        0
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(words[i - 15]!, 7) ^ rotr(words[i - 15]!, 18) ^ (words[i - 15]! >>> 3)
      const s1 = rotr(words[i - 2]!, 17) ^ rotr(words[i - 2]!, 19) ^ (words[i - 2]! >>> 10)
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = Array.from(this.state) as number[]
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)
      const ch = (e! & f!) ^ (~e! & g!)
      const temp1 = (h! + s1 + (ch >>> 0) + SHA256_K[i]! + words[i]!) >>> 0
      const s0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!)
      const temp2 = (s0 + (maj >>> 0)) >>> 0
      h = g
      g = f
      f = e
      e = (d! + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    const next = [a!, b!, c!, d!, e!, f!, g!, h!]
    for (let i = 0; i < 8; i++) this.state[i] = (this.state[i]! + next[i]!) >>> 0
  }

  protected hex(): string {
    return toHexBE(this.truncated ? this.state.subarray(0, 7) : this.state)
  }
}

/**
 * SHA-512 / SHA-384 on 32 bit halves - BigInt would be far slower on the
 * multi-gigabyte files this editor is built for.
 */
class Sha512Hasher extends BlockHasher {
  private readonly hi: Uint32Array
  private readonly lo: Uint32Array
  private readonly wHi = new Uint32Array(80)
  private readonly wLo = new Uint32Array(80)

  constructor(private readonly bits: 384 | 512) {
    super(128)
    const init =
      bits === 512
        ? [
            0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a,
            0x5f1d36f1, 0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b,
            0x5be0cd19, 0x137e2179,
          ]
        : [
            0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8,
            0xf70e5939, 0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7,
            0x47b5481d, 0xbefa4fa4,
          ]
    this.hi = new Uint32Array(8)
    this.lo = new Uint32Array(8)
    for (let i = 0; i < 8; i++) {
      this.hi[i] = init[i * 2]!
      this.lo[i] = init[i * 2 + 1]!
    }
  }

  protected compress(data: Uint8Array, offset: number): void {
    const { wHi, wLo } = this
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 8
      wHi[i] =
        ((data[base]! << 24) | (data[base + 1]! << 16) | (data[base + 2]! << 8) | data[base + 3]!) >>>
        0
      wLo[i] =
        ((data[base + 4]! << 24) |
          (data[base + 5]! << 16) |
          (data[base + 6]! << 8) |
          data[base + 7]!) >>>
        0
    }

    for (let i = 16; i < 80; i++) {
      // s0 = ror(w[i-15], 1) ^ ror(w[i-15], 8) ^ shr(w[i-15], 7)
      const x15Hi = wHi[i - 15]!
      const x15Lo = wLo[i - 15]!
      const s0Hi =
        (rotrHi(x15Hi, x15Lo, 1) ^ rotrHi(x15Hi, x15Lo, 8) ^ shrHi(x15Hi, 7)) >>> 0
      const s0Lo =
        (rotrLo(x15Hi, x15Lo, 1) ^ rotrLo(x15Hi, x15Lo, 8) ^ shrLo(x15Hi, x15Lo, 7)) >>> 0

      const x2Hi = wHi[i - 2]!
      const x2Lo = wLo[i - 2]!
      const s1Hi = (rotrHi(x2Hi, x2Lo, 19) ^ rotrHi(x2Hi, x2Lo, 61) ^ shrHi(x2Hi, 6)) >>> 0
      const s1Lo = (rotrLo(x2Hi, x2Lo, 19) ^ rotrLo(x2Hi, x2Lo, 61) ^ shrLo(x2Hi, x2Lo, 6)) >>> 0

      let lo = (wLo[i - 16]! + s0Lo) >>> 0
      let hi = (wHi[i - 16]! + s0Hi + (lo < s0Lo ? 1 : 0)) >>> 0
      const lo2 = (lo + wLo[i - 7]!) >>> 0
      hi = (hi + wHi[i - 7]! + (lo2 < lo ? 1 : 0)) >>> 0
      lo = lo2
      const lo3 = (lo + s1Lo) >>> 0
      hi = (hi + s1Hi + (lo3 < lo ? 1 : 0)) >>> 0
      wHi[i] = hi
      wLo[i] = lo3
    }

    let aHi = this.hi[0]!
    let aLo = this.lo[0]!
    let bHi = this.hi[1]!
    let bLo = this.lo[1]!
    let cHi = this.hi[2]!
    let cLo = this.lo[2]!
    let dHi = this.hi[3]!
    let dLo = this.lo[3]!
    let eHi = this.hi[4]!
    let eLo = this.lo[4]!
    let fHi = this.hi[5]!
    let fLo = this.lo[5]!
    let gHi = this.hi[6]!
    let gLo = this.lo[6]!
    let hHi = this.hi[7]!
    let hLo = this.lo[7]!

    for (let i = 0; i < 80; i++) {
      const s1Hi = (rotrHi(eHi, eLo, 14) ^ rotrHi(eHi, eLo, 18) ^ rotrHi(eHi, eLo, 41)) >>> 0
      const s1Lo = (rotrLo(eHi, eLo, 14) ^ rotrLo(eHi, eLo, 18) ^ rotrLo(eHi, eLo, 41)) >>> 0
      const chHi = ((eHi & fHi) ^ (~eHi & gHi)) >>> 0
      const chLo = ((eLo & fLo) ^ (~eLo & gLo)) >>> 0

      let t1Lo = (hLo + s1Lo) >>> 0
      let t1Hi = (hHi + s1Hi + (t1Lo < s1Lo ? 1 : 0)) >>> 0
      let next = (t1Lo + chLo) >>> 0
      t1Hi = (t1Hi + chHi + (next < t1Lo ? 1 : 0)) >>> 0
      t1Lo = next
      next = (t1Lo + SHA512_K_LO[i]!) >>> 0
      t1Hi = (t1Hi + SHA512_K_HI[i]! + (next < t1Lo ? 1 : 0)) >>> 0
      t1Lo = next
      next = (t1Lo + wLo[i]!) >>> 0
      t1Hi = (t1Hi + wHi[i]! + (next < t1Lo ? 1 : 0)) >>> 0
      t1Lo = next

      const s0Hi = (rotrHi(aHi, aLo, 28) ^ rotrHi(aHi, aLo, 34) ^ rotrHi(aHi, aLo, 39)) >>> 0
      const s0Lo = (rotrLo(aHi, aLo, 28) ^ rotrLo(aHi, aLo, 34) ^ rotrLo(aHi, aLo, 39)) >>> 0
      const majHi = ((aHi & bHi) ^ (aHi & cHi) ^ (bHi & cHi)) >>> 0
      const majLo = ((aLo & bLo) ^ (aLo & cLo) ^ (bLo & cLo)) >>> 0
      const t2Lo = (s0Lo + majLo) >>> 0
      const t2Hi = (s0Hi + majHi + (t2Lo < majLo ? 1 : 0)) >>> 0

      hHi = gHi
      hLo = gLo
      gHi = fHi
      gLo = fLo
      fHi = eHi
      fLo = eLo
      let lo = (dLo + t1Lo) >>> 0
      eHi = (dHi + t1Hi + (lo < t1Lo ? 1 : 0)) >>> 0
      eLo = lo
      dHi = cHi
      dLo = cLo
      cHi = bHi
      cLo = bLo
      bHi = aHi
      bLo = aLo
      lo = (t1Lo + t2Lo) >>> 0
      aHi = (t1Hi + t2Hi + (lo < t2Lo ? 1 : 0)) >>> 0
      aLo = lo
    }

    this.addState(0, aHi, aLo)
    this.addState(1, bHi, bLo)
    this.addState(2, cHi, cLo)
    this.addState(3, dHi, dLo)
    this.addState(4, eHi, eLo)
    this.addState(5, fHi, fLo)
    this.addState(6, gHi, gLo)
    this.addState(7, hHi, hLo)
  }

  private addState(index: number, hi: number, lo: number): void {
    const low = (this.lo[index]! + lo) >>> 0
    this.hi[index] = (this.hi[index]! + hi + (low < lo ? 1 : 0)) >>> 0
    this.lo[index] = low
  }

  protected finish(): void {
    const bitLength = this.totalLength * 8
    const padded = new Uint8Array(this.blockLength < 112 ? 128 : 256)
    padded.set(this.block.subarray(0, this.blockLength))
    padded[this.blockLength] = 0x80
    const dv = new DataView(padded.buffer)
    dv.setUint32(padded.length - 8, Math.floor(bitLength / 4294967296), false)
    dv.setUint32(padded.length - 4, bitLength >>> 0, false)
    for (let offset = 0; offset < padded.length; offset += 128) this.compress(padded, offset)
  }

  protected hex(): string {
    const words = this.bits === 512 ? 8 : 6
    let out = ''
    for (let i = 0; i < words; i++) {
      out += this.hi[i]!.toString(16).padStart(8, '0')
      out += this.lo[i]!.toString(16).padStart(8, '0')
    }
    return out
  }
}

/* 64 bit helpers expressed on 32 bit halves. `n` is a rotation of 1..63. */
function rotrHi(hi: number, lo: number, n: number): number {
  if (n === 32) return lo >>> 0
  return n < 32 ? ((hi >>> n) | (lo << (32 - n))) >>> 0 : ((lo >>> (n - 32)) | (hi << (64 - n))) >>> 0
}

function rotrLo(hi: number, lo: number, n: number): number {
  if (n === 32) return hi >>> 0
  return n < 32 ? ((lo >>> n) | (hi << (32 - n))) >>> 0 : ((hi >>> (n - 32)) | (lo << (64 - n))) >>> 0
}

function shrHi(hi: number, n: number): number {
  return n < 32 ? hi >>> n : 0
}

function shrLo(hi: number, lo: number, n: number): number {
  return n < 32 ? ((lo >>> n) | (hi << (32 - n))) >>> 0 : (hi >>> (n - 32)) >>> 0
}

const SHA512_K_HI = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  0xca273ece, 0xd186b8c7, 0xeada7dd6, 0xf57d4f7f, 0x06f067aa, 0x0a637dc5, 0x113f9804, 0x1b710b35,
  0x28db77f5, 0x32caab7b, 0x3c9ebe0a, 0x431d67c4, 0x4cc5d4be, 0x597f299c, 0x5fcb6fab, 0x6c44198c,
])

const SHA512_K_LO = new Uint32Array([
  0xd728ae22, 0x23ef65cd, 0xec4d3b2f, 0x8189dbbc, 0xf348b538, 0xb605d019, 0xaf194f9b, 0xda6d8118,
  0xa3030242, 0x45706fbe, 0x4ee4b28c, 0xd5ffb4e2, 0xf27b896f, 0x3b1696b1, 0x25c71235, 0xcf692694,
  0x9ef14ad2, 0x384f25e3, 0x8b8cd5b5, 0x77ac9c65, 0x592b0275, 0x6ea6e483, 0xbd41fbd4, 0x831153b5,
  0xee66dfab, 0x2db43210, 0x98fb213f, 0xbeef0ee4, 0x3da88fc2, 0x930aa725, 0xe003826f, 0x0a0e6e70,
  0x46d22ffc, 0x5c26c926, 0x5ac42aed, 0x9d95b3df, 0x8baf63de, 0x3c77b2a8, 0x47edaee6, 0x1482353b,
  0x4cf10364, 0xbc423001, 0xd0f89791, 0x0654be30, 0xd6ef5218, 0x5565a910, 0x5771202a, 0x32bbd1b8,
  0xb8d2d0c8, 0x5141ab53, 0xdf8eeb99, 0xe19b48a8, 0xc5c95a63, 0xe3418acb, 0x7763e373, 0xd6b2b8a3,
  0x5defb2fc, 0x43172f60, 0xa1f0ab72, 0x1a6439ec, 0x23631e28, 0xde82bde9, 0xb2c67915, 0xe372532b,
  0xea26619c, 0x21c0c207, 0xcde0eb1e, 0xee6ed178, 0x72176fba, 0xa2c898a6, 0xbef90dae, 0x131c471b,
  0x23047d84, 0x40c72493, 0x15c9bebc, 0x9c100d4c, 0xcb3e42b6, 0xfc657e2a, 0x3ad6faec, 0x4a475817,
])

/* ------------------------------------------------------------ registry ---- */

export const HASH_ALGORITHMS: HashAlgorithm[] = [
  { id: 'sum', label: 'Sum (32 bit)', group: 'Checksum' },
  { id: 'xor', label: 'XOR (8 bit)', group: 'Checksum' },
  { id: 'adler-32', label: 'Adler-32', group: 'Checksum' },
  ...Object.keys(CRC_SPECS).map((id) => ({
    id,
    label: id.toUpperCase().replace(/^(CRC-\d+)-/, '$1/'),
    group: 'CRC' as const,
  })),
  { id: 'md5', label: 'MD5', group: 'Cryptographic' },
  { id: 'sha-1', label: 'SHA-1', group: 'Cryptographic' },
  { id: 'sha-224', label: 'SHA-224', group: 'Cryptographic' },
  { id: 'sha-256', label: 'SHA-256', group: 'Cryptographic' },
  { id: 'sha-384', label: 'SHA-384', group: 'Cryptographic' },
  { id: 'sha-512', label: 'SHA-512', group: 'Cryptographic' },
]

export function createHasher(id: string): Hasher {
  const crc = CRC_SPECS[id]
  if (crc) return new CrcHasher(id, crc)
  switch (id) {
    case 'sum':
      return new SumHasher()
    case 'xor':
      return new XorHasher()
    case 'adler-32':
      return new Adler32Hasher()
    case 'md5':
      return new Md5Hasher()
    case 'sha-1':
      return new Sha1Hasher()
    case 'sha-224':
      return new Sha256Hasher(true)
    case 'sha-256':
      return new Sha256Hasher()
    case 'sha-384':
      return new Sha512Hasher(384)
    case 'sha-512':
      return new Sha512Hasher(512)
    default:
      throw new Error(`Unknown hash algorithm "${id}".`)
  }
}

/** Convenience helper for one-shot hashing of a buffer. */
export function hashBytes(id: string, bytes: Uint8Array): string {
  const hasher = createHasher(id)
  hasher.update(bytes)
  return hasher.digest()
}
