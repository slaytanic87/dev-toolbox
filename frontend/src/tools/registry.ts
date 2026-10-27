/**
 * Single source of truth for every tool: navigation, routing and search
 * are all generated from this list. Adding a tool = adding one entry.
 */

import type { Component } from 'vue'

import type { IconName } from '@/components/ui/icons'

export interface ToolDefinition {
  id: string
  path: string
  name: string
  short: string
  tagline: string
  icon: IconName
  keywords: string[]
  component: () => Promise<Component>
}

export const TOOLS: ToolDefinition[] = [
  {
    id: 'qr',
    path: '/qr',
    name: 'QR Studio',
    short: 'QR',
    tagline: 'Encode payloads to QR and decode codes from pasted or uploaded images.',
    icon: 'qr',
    keywords: ['qr', 'barcode', 'scan', 'wifi', 'vcard', 'otp', 'decode', 'encode'],
    component: () => import('@/views/QrCodeView.vue'),
  },
  {
    id: 'jwt',
    path: '/jwt',
    name: 'JWT Workbench',
    short: 'JWT',
    tagline: 'Decode, verify and sign JSON Web Tokens with HS, RS, PS and ES algorithms.',
    icon: 'key',
    keywords: ['jwt', 'token', 'jws', 'claims', 'hs256', 'rs256', 'sign', 'verify', 'auth'],
    component: () => import('@/views/JwtView.vue'),
  },
  {
    id: 'url',
    path: '/url',
    name: 'URL Codec',
    short: 'URL',
    tagline: 'Percent-encode, decode and dissect URLs including their query string.',
    icon: 'link',
    keywords: ['url', 'uri', 'percent', 'encode', 'decode', 'query', 'params'],
    component: () => import('@/views/UrlView.vue'),
  },
  {
    id: 'json',
    path: '/json',
    name: 'JSON Formatter',
    short: 'JSON',
    tagline: 'Format, minify, sort, inspect and query JSON documents.',
    icon: 'braces',
    keywords: ['json', 'format', 'beautify', 'pretty', 'minify', 'validate', 'tree', 'jsonpath'],
    component: () => import('@/views/JsonView.vue'),
  },
  {
    id: 'base64',
    path: '/base64',
    name: 'Base64 Codec',
    short: 'B64',
    tagline: 'Convert text and files to Base64 / Base64URL and back.',
    icon: 'binary',
    keywords: ['base64', 'base64url', 'encode', 'decode', 'binary', 'hex', 'file', 'data uri'],
    component: () => import('@/views/Base64View.vue'),
  },
  {
    id: 'regex',
    path: '/regex',
    name: 'RegEx Lab',
    short: 'RE',
    tagline: 'Live regular expression testing with matches, groups and substitution.',
    icon: 'regex',
    keywords: ['regex', 'regexp', 'pattern', 'match', 'replace', 'test', 'regex101'],
    component: () => import('@/views/RegexView.vue'),
  },
  {
    id: 'uuid',
    path: '/uuid',
    name: 'ID Generator',
    short: 'UUID',
    tagline: 'Bulk generate UUID v4/v7, ULID, NanoID and inspect existing UUIDs.',
    icon: 'fingerprint',
    keywords: ['uuid', 'guid', 'ulid', 'nanoid', 'random', 'id', 'generator', 'v4', 'v7'],
    component: () => import('@/views/UuidView.vue'),
  },
  {
    id: 'hex',
    path: '/hex',
    name: 'Hex Editor',
    short: 'HEX',
    tagline: 'Read and edit binary files of any size, chunk by chunk, and save them back.',
    icon: 'hex',
    keywords: [
      'hex',
      'hexeditor',
      'hex editor',
      'binary',
      'bytes',
      'dump',
      'hexdump',
      'editor',
      'patch',
      'firmware',
      'intel hex',
      'srec',
      'entropy',
      'checksum',
      'crc',
      'md5',
      'sha',
      'inspector',
      'endian',
      'offset',
      'reverse engineering',
    ],
    component: () => import('@/views/HexView.vue'),
  },
  {
    id: 'rest',
    path: '/rest',
    name: 'REST Client',
    short: 'REST',
    tagline: 'Send HTTP requests with headers, auth and bodies - Postman in a tab.',
    icon: 'send',
    keywords: ['rest', 'http', 'api', 'postman', 'request', 'curl', 'fetch', 'client'],
    component: () => import('@/views/RestClientView.vue'),
  },
  {
    id: 'certs',
    path: '/certificates',
    name: 'X.509 Forge',
    short: 'X509',
    tagline: 'Generate key pairs, self-signed, CA and CA-signed certificates plus CSRs.',
    icon: 'certificate',
    keywords: [
      'certificate',
      'x509',
      'x.509',
      'tls',
      'ssl',
      'ca',
      'csr',
      'pem',
      'der',
      'crt',
      'cert',
      'key',
      'pkcs8',
      'rsa',
      'ecdsa',
      'ed25519',
      'openssl',
      'mtls',
      'https',
    ],
    component: () => import('@/views/CertificateView.vue'),
  },
  {
    id: 'ip',
    path: '/ip',
    name: 'IP Calculator',
    short: 'IP',
    tagline: 'Subnet IPv4 & IPv6 networks and inspect the mask/wildcard bit math.',
    icon: 'network',
    keywords: [
      'ip',
      'ipv4',
      'ipv6',
      'subnet',
      'subnetting',
      'cidr',
      'netmask',
      'subnet mask',
      'wildcard mask',
      'network',
      'broadcast',
      'host range',
      'vlsm',
      'classful',
      'prefix',
    ],
    component: () => import('@/views/IpCalculatorView.vue'),
  },
]

export const TOOL_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]))

export function searchTools(query: string): ToolDefinition[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return TOOLS
  return TOOLS.filter((tool) =>
    [tool.name, tool.short, tool.tagline, ...tool.keywords]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
}
