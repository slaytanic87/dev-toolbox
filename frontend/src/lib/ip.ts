/**
 * IPv4 / IPv6 subnet calculator primitives.
 *
 * IPv4 addresses and masks are plain 32 bit unsigned numbers (fits safely in
 * a JS number). IPv6 needs the full 128 bits, so it is modelled with BigInt
 * throughout.
 */

/* ========================================================================== */
/* IPv4                                                                      */
/* ========================================================================== */

export interface Ipv4Info {
  address: number
  prefix: number
  mask: number
  wildcard: number
  network: number
  broadcast: number
  firstHost: number
  lastHost: number
  totalAddresses: number
  usableHosts: number
}

export function parseIpv4(input: string): number {
  const octets = input.trim().split('.')
  if (octets.length !== 4) {
    throw new Error('An IPv4 address needs exactly 4 dot separated octets.')
  }
  let value = 0
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) throw new Error(`"${octet}" is not a valid octet.`)
    const n = Number(octet)
    if (n > 255) throw new Error(`"${octet}" is out of range (0-255).`)
    value = (value << 8) | n
  }
  return value >>> 0
}

export function isValidIpv4(input: string): boolean {
  try {
    parseIpv4(input)
    return true
  } catch {
    return false
  }
}

export function formatIpv4(value: number): string {
  const v = value >>> 0
  return [24, 16, 8, 0].map((shift) => (v >>> shift) & 0xff).join('.')
}

export function maskFromPrefix4(prefix: number): number {
  if (prefix <= 0) return 0
  if (prefix >= 32) return 0xffffffff >>> 0
  return (0xffffffff << (32 - prefix)) >>> 0
}

/** Returns `null` when the mask is not a contiguous run of leading 1 bits. */
export function prefixFromMask4(mask: number): number | null {
  const m = mask >>> 0
  let prefix = 0
  while (prefix < 32 && ((m >>> (31 - prefix)) & 1) === 1) prefix++
  return maskFromPrefix4(prefix) === m ? prefix : null
}

/** Accepts a CIDR prefix ("24", "/24") or a dotted subnet mask ("255.255.255.0"). */
export function parsePrefixOrMask4(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') throw new Error('Enter a prefix length or subnet mask.')
  if (trimmed.includes('.')) {
    const prefix = prefixFromMask4(parseIpv4(trimmed))
    if (prefix === null) throw new Error('Not a valid contiguous subnet mask.')
    return prefix
  }
  const cleaned = trimmed.replace(/^\//, '')
  if (!/^\d{1,3}$/.test(cleaned)) throw new Error('Prefix must be a number between 0 and 32.')
  const n = Number(cleaned)
  if (n < 0 || n > 32) throw new Error('Prefix must be between 0 and 32.')
  return n
}

export type Ipv4Class = 'A' | 'B' | 'C' | 'D' | 'E'

export function classifyIpv4(address: number): Ipv4Class {
  const first = (address >>> 24) & 0xff
  if (first < 128) return 'A'
  if (first < 192) return 'B'
  if (first < 224) return 'C'
  if (first < 240) return 'D'
  return 'E'
}

/** Default classful mask length for class A/B/C networks (class D/E fall back to /24). */
export function prefixFromClassfulMask(ipClass: Ipv4Class): number {
  switch (ipClass) {
    case 'A':
      return 8
    case 'B':
      return 16
    default:
      return 24
  }
}

export interface Ipv4Scope {
  isPrivate: boolean
  isLoopback: boolean
  isLinkLocal: boolean
  isMulticast: boolean
  isCarrierGradeNat: boolean
  label: string
}

const SCOPE_RANGES_4: Array<{ test: (a: number) => boolean; label: string }> = [
  { test: (a) => inRange4(a, '127.0.0.0', 8), label: 'Loopback' },
  { test: (a) => inRange4(a, '169.254.0.0', 16), label: 'Link-local' },
  { test: (a) => inRange4(a, '10.0.0.0', 8), label: 'Private (RFC 1918)' },
  { test: (a) => inRange4(a, '172.16.0.0', 12), label: 'Private (RFC 1918)' },
  { test: (a) => inRange4(a, '192.168.0.0', 16), label: 'Private (RFC 1918)' },
  { test: (a) => inRange4(a, '100.64.0.0', 10), label: 'Carrier-grade NAT (RFC 6598)' },
  { test: (a) => inRange4(a, '224.0.0.0', 4), label: 'Multicast' },
]

function inRange4(address: number, base: string, prefix: number): boolean {
  const mask = maskFromPrefix4(prefix)
  return (address & mask) >>> 0 === (parseIpv4(base) & mask) >>> 0
}

export function scopeOfIpv4(address: number): Ipv4Scope {
  const match = SCOPE_RANGES_4.find((range) => range.test(address))
  return {
    isPrivate: match?.label.startsWith('Private') ?? false,
    isLoopback: match?.label === 'Loopback',
    isLinkLocal: match?.label === 'Link-local',
    isMulticast: match?.label === 'Multicast',
    isCarrierGradeNat: match?.label.startsWith('Carrier') ?? false,
    label: match?.label ?? 'Public / global unicast',
  }
}

export function analyzeIpv4(address: number, prefix: number): Ipv4Info {
  if (prefix < 0 || prefix > 32) throw new Error('Prefix must be between 0 and 32.')
  const mask = maskFromPrefix4(prefix)
  const wildcard = ~mask >>> 0
  const network = (address & mask) >>> 0
  const broadcast = (network | wildcard) >>> 0
  const totalAddresses = 2 ** (32 - prefix)

  // RFC 3021: /31 point-to-point links have no network/broadcast reservation,
  // both addresses are usable. /32 is a single host route.
  const firstHost = prefix >= 31 ? network : (network + 1) >>> 0
  const lastHost = prefix >= 31 ? broadcast : (broadcast - 1) >>> 0
  const usableHosts = prefix >= 31 ? (prefix === 32 ? 1 : 2) : totalAddresses - 2

  return { address, prefix, mask, wildcard, network, broadcast, firstHost, lastHost, totalAddresses, usableHosts }
}

export interface SubnetPlan4 {
  newPrefix: number
  blockSize: number
  requested: number
  available: number
  truncated: boolean
  subnets: Ipv4Info[]
}

const MAX_SUBNET_ROWS = 1024

export function planSubnetsIpv4(network: number, prefix: number, count: number): SubnetPlan4 {
  const requested = Math.max(1, Math.floor(count) || 1)
  const extraBits = requested <= 1 ? 0 : Math.ceil(Math.log2(requested))
  const newPrefix = prefix + extraBits
  if (newPrefix > 32) {
    throw new Error(`A /${prefix} network cannot be split into ${requested} subnet(s) - not enough address space.`)
  }
  const blockSize = 2 ** (32 - newPrefix)
  const available = 2 ** extraBits
  const listCount = Math.min(requested, MAX_SUBNET_ROWS)
  const subnets = Array.from({ length: listCount }, (_, i) =>
    analyzeIpv4((network + i * blockSize) >>> 0, newPrefix),
  )
  return { newPrefix, blockSize, requested, available, truncated: requested > MAX_SUBNET_ROWS, subnets }
}

export function toBinaryOctets(value: number): string[] {
  const v = value >>> 0
  return [24, 16, 8, 0].map((shift) => ((v >>> shift) & 0xff).toString(2).padStart(8, '0'))
}

/* ========================================================================== */
/* IPv6                                                                      */
/* ========================================================================== */

const MAX_128 = (1n << 128n) - 1n

export interface Ipv6Info {
  address: bigint
  prefix: number
  mask: bigint
  wildcard: bigint
  network: bigint
  lastAddress: bigint
  firstHost: bigint
  lastHost: bigint
  totalAddresses: bigint
}

export function parseIpv6(input: string): bigint {
  const withoutZone = input.trim().split('%')[0] as string
  if (withoutZone === '') throw new Error('Enter an IPv6 address.')
  if (/:::/.test(withoutZone)) throw new Error('Invalid IPv6 address (too many consecutive colons).')

  const doubleColonCount = (withoutZone.match(/::/g) ?? []).length
  if (doubleColonCount > 1) throw new Error('Only one "::" is allowed in an IPv6 address.')

  const expandEmbeddedIpv4 = (groups: string[]): string[] => {
    const last = groups[groups.length - 1]
    if (groups.length === 0 || last === undefined || !last.includes('.')) return groups
    const v4 = parseIpv4(last)
    const hi = ((v4 >>> 16) & 0xffff).toString(16)
    const lo = (v4 & 0xffff).toString(16)
    return [...groups.slice(0, -1), hi, lo]
  }

  let groups: string[]
  if (doubleColonCount === 1) {
    const [headPart = '', tailPart = ''] = withoutZone.split('::')
    const headGroups = expandEmbeddedIpv4(headPart === '' ? [] : headPart.split(':'))
    const tailGroups = expandEmbeddedIpv4(tailPart === '' ? [] : tailPart.split(':'))
    const missing = 8 - headGroups.length - tailGroups.length
    if (missing < 0) throw new Error('Too many groups for a compressed IPv6 address.')
    groups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups]
  } else {
    groups = expandEmbeddedIpv4(withoutZone.split(':'))
    if (groups.length !== 8) {
      throw new Error('A fully expanded IPv6 address needs exactly 8 groups (use "::" to compress zeros).')
    }
  }

  let value = 0n
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) throw new Error(`"${group}" is not a valid hextet.`)
    value = (value << 16n) | BigInt(parseInt(group, 16))
  }
  return value
}

export function isValidIpv6(input: string): boolean {
  try {
    parseIpv6(input)
    return true
  } catch {
    return false
  }
}

export function toHexHextets(value: bigint): string[] {
  const groups: string[] = []
  for (let i = 7; i >= 0; i--) {
    groups.push(((value >> BigInt(i * 16)) & 0xffffn).toString(16).padStart(4, '0'))
  }
  return groups
}

export function toBinaryHextets(value: bigint): string[] {
  const groups: string[] = []
  for (let i = 7; i >= 0; i--) {
    groups.push(((value >> BigInt(i * 16)) & 0xffffn).toString(2).padStart(16, '0'))
  }
  return groups
}

export function formatIpv6(value: bigint, compress = true): string {
  const groups = toHexHextets(value).map((g) => g.replace(/^0+(?=.)/, ''))
  if (!compress) return groups.join(':')

  let bestStart = -1
  let bestLen = 0
  let curStart = -1
  let curLen = 0
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === '0') {
      if (curStart === -1) curStart = i
      curLen++
      if (curLen > bestLen) {
        bestLen = curLen
        bestStart = curStart
      }
    } else {
      curStart = -1
      curLen = 0
    }
  }
  if (bestLen < 2) return groups.join(':')

  const head = groups.slice(0, bestStart)
  const tail = groups.slice(bestStart + bestLen)
  if (head.length === 0 && tail.length === 0) return '::'
  if (head.length === 0) return `::${tail.join(':')}`
  if (tail.length === 0) return `${head.join(':')}::`
  return `${head.join(':')}::${tail.join(':')}`
}

export function maskFromPrefix6(prefix: number): bigint {
  if (prefix <= 0) return 0n
  if (prefix >= 128) return MAX_128
  return (MAX_128 << BigInt(128 - prefix)) & MAX_128
}

export function scopeOfIpv6(address: bigint): string {
  if (address === 0n) return 'Unspecified'
  if (address === 1n) return 'Loopback'
  if (address >> 120n === 0xffn) return 'Multicast'
  if (address >> 118n === 0b1111111010n) return 'Link-local'
  if (address >> 121n === 0b1111110n) return 'Unique local (RFC 4193)'
  if (address >> 96n === 0x20010db8n) return 'Documentation (RFC 3849)'
  if ((address >> 80n) === 0xffffn && address >> 96n === 0n) return 'IPv4-mapped'
  return 'Global unicast'
}

export function analyzeIpv6(address: bigint, prefix: number): Ipv6Info {
  if (prefix < 0 || prefix > 128) throw new Error('Prefix must be between 0 and 128.')
  const mask = maskFromPrefix6(prefix)
  const wildcard = ~mask & MAX_128
  const network = address & mask
  const lastAddress = network | wildcard
  const totalAddresses = 1n << BigInt(128 - prefix)

  const firstHost = prefix >= 127 ? network : network + 1n
  const lastHost = prefix >= 127 ? lastAddress : lastAddress - 1n

  return { address, prefix, mask, wildcard, network, lastAddress, firstHost, lastHost, totalAddresses }
}

export interface SubnetPlan6 {
  newPrefix: number
  blockSize: bigint
  requested: number
  available: number
  truncated: boolean
  subnets: Ipv6Info[]
}

export function planSubnetsIpv6(network: bigint, prefix: number, count: number): SubnetPlan6 {
  const requested = Math.max(1, Math.floor(count) || 1)
  const extraBits = requested <= 1 ? 0 : Math.ceil(Math.log2(requested))
  const newPrefix = prefix + extraBits
  if (newPrefix > 128) {
    throw new Error(`A /${prefix} network cannot be split into ${requested} subnet(s) - not enough address space.`)
  }
  const blockSize = 1n << BigInt(128 - newPrefix)
  const available = 2 ** extraBits
  const listCount = Math.min(requested, MAX_SUBNET_ROWS)
  const subnets = Array.from({ length: listCount }, (_, i) =>
    analyzeIpv6(network + BigInt(i) * blockSize, newPrefix),
  )
  return { newPrefix, blockSize, requested, available, truncated: requested > MAX_SUBNET_ROWS, subnets }
}

/* ========================================================================== */
/* shared helpers                                                            */
/* ========================================================================== */

/** Splits a fixed width group of bits into the "network" and "host" portion for display. */
export interface BitGroupSplit {
  network: string
  host: string
}

export function splitBitGroups(groups: string[], prefix: number, groupSize: number): BitGroupSplit[] {
  return groups.map((group, index) => {
    const bitsBefore = index * groupSize
    const networkBits = Math.min(groupSize, Math.max(0, prefix - bitsBefore))
    return { network: group.slice(0, networkBits), host: group.slice(networkBits) }
  })
}

export const SAMPLE_IPV4 = '192.168.1.10'
export const SAMPLE_PREFIX4 = 24
export const SAMPLE_IPV6 = '2001:db8:abcd:0012::'
export const SAMPLE_PREFIX6 = 64
