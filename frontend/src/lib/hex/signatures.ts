/**
 * Magic byte based file format identification.
 *
 * Only the first few kilobytes (plus a couple of well known fixed offsets) are
 * needed, so identifying a 50 GiB disk image costs one chunk read.
 */

export interface Signature {
  name: string
  extension: string
  mime: string
  /** Hex pattern, `??` matches any byte. */
  magic: string
  offset?: number
}

export interface FormatMatch {
  name: string
  extension: string
  mime: string
  offset: number
  /** Number of fixed (non wildcard) bytes that matched. */
  strength: number
}

/** How much of the file the identifier wants to see. */
export const IDENTIFY_WINDOW = 0x9000

export const SIGNATURES: Signature[] = [
  { name: 'PNG image', extension: 'png', mime: 'image/png', magic: '89504E470D0A1A0A' },
  { name: 'JPEG image', extension: 'jpg', mime: 'image/jpeg', magic: 'FFD8FF' },
  { name: 'GIF image (87a)', extension: 'gif', mime: 'image/gif', magic: '474946383761' },
  { name: 'GIF image (89a)', extension: 'gif', mime: 'image/gif', magic: '474946383961' },
  { name: 'BMP image', extension: 'bmp', mime: 'image/bmp', magic: '424D' },
  { name: 'WebP image', extension: 'webp', mime: 'image/webp', magic: '52494646????????57454250' },
  { name: 'TIFF image (LE)', extension: 'tif', mime: 'image/tiff', magic: '49492A00' },
  { name: 'TIFF image (BE)', extension: 'tif', mime: 'image/tiff', magic: '4D4D002A' },
  { name: 'ICO icon', extension: 'ico', mime: 'image/x-icon', magic: '00000100' },
  { name: 'CUR cursor', extension: 'cur', mime: 'image/x-icon', magic: '00000200' },
  { name: 'Photoshop document', extension: 'psd', mime: 'image/vnd.adobe.photoshop', magic: '38425053' },
  { name: 'AVIF / HEIF image', extension: 'avif', mime: 'image/avif', magic: '????????6674797061766966' },
  { name: 'HEIC image', extension: 'heic', mime: 'image/heic', magic: '????????6674797068656963' },
  { name: 'JPEG 2000', extension: 'jp2', mime: 'image/jp2', magic: '0000000C6A5020200D0A870A' },
  { name: 'OpenEXR image', extension: 'exr', mime: 'image/x-exr', magic: '762F3101' },
  { name: 'SVG / XML', extension: 'svg', mime: 'image/svg+xml', magic: '3C3F786D6C' },

  { name: 'PDF document', extension: 'pdf', mime: 'application/pdf', magic: '25504446' },
  { name: 'PostScript', extension: 'ps', mime: 'application/postscript', magic: '25215053' },
  { name: 'RTF document', extension: 'rtf', mime: 'application/rtf', magic: '7B5C727466' },
  {
    name: 'OLE2 / legacy Office document',
    extension: 'doc',
    mime: 'application/x-ole-storage',
    magic: 'D0CF11E0A1B11AE1',
  },
  { name: 'ZIP archive (or OOXML / JAR / APK)', extension: 'zip', mime: 'application/zip', magic: '504B0304' },
  { name: 'ZIP archive (empty)', extension: 'zip', mime: 'application/zip', magic: '504B0506' },
  { name: 'ZIP archive (spanned)', extension: 'zip', mime: 'application/zip', magic: '504B0708' },
  { name: 'RAR archive (v1.5)', extension: 'rar', mime: 'application/vnd.rar', magic: '526172211A0700' },
  { name: 'RAR archive (v5)', extension: 'rar', mime: 'application/vnd.rar', magic: '526172211A070100' },
  { name: '7-Zip archive', extension: '7z', mime: 'application/x-7z-compressed', magic: '377ABCAF271C' },
  { name: 'GZIP archive', extension: 'gz', mime: 'application/gzip', magic: '1F8B08' },
  { name: 'BZIP2 archive', extension: 'bz2', mime: 'application/x-bzip2', magic: '425A68' },
  { name: 'XZ archive', extension: 'xz', mime: 'application/x-xz', magic: 'FD377A585A00' },
  { name: 'Zstandard archive', extension: 'zst', mime: 'application/zstd', magic: '28B52FFD' },
  { name: 'LZ4 frame', extension: 'lz4', mime: 'application/x-lz4', magic: '04224D18' },
  { name: 'TAR archive', extension: 'tar', mime: 'application/x-tar', magic: '7573746172', offset: 257 },
  { name: 'CAB archive', extension: 'cab', mime: 'application/vnd.ms-cab-compressed', magic: '4D53434600000000' },
  { name: 'Debian package', extension: 'deb', mime: 'application/vnd.debian.binary-package', magic: '213C617263683E' },
  { name: 'RPM package', extension: 'rpm', mime: 'application/x-rpm', magic: 'EDABEEDB' },
  { name: 'Apple disk image', extension: 'dmg', mime: 'application/x-apple-diskimage', magic: '7801730D626260' },
  { name: 'ISO 9660 image', extension: 'iso', mime: 'application/x-iso9660-image', magic: '4344303031', offset: 0x8001 },

  { name: 'MP3 audio (ID3)', extension: 'mp3', mime: 'audio/mpeg', magic: '494433' },
  { name: 'MP3 audio (frame)', extension: 'mp3', mime: 'audio/mpeg', magic: 'FFFB' },
  { name: 'FLAC audio', extension: 'flac', mime: 'audio/flac', magic: '664C6143' },
  { name: 'OGG container', extension: 'ogg', mime: 'audio/ogg', magic: '4F676753' },
  { name: 'WAV audio', extension: 'wav', mime: 'audio/wav', magic: '52494646????????57415645' },
  { name: 'AVI video', extension: 'avi', mime: 'video/x-msvideo', magic: '52494646????????41564920' },
  { name: 'MIDI sequence', extension: 'mid', mime: 'audio/midi', magic: '4D546864' },
  { name: 'MP4 / MOV container', extension: 'mp4', mime: 'video/mp4', magic: '????????66747970' },
  { name: 'Matroska / WebM', extension: 'mkv', mime: 'video/x-matroska', magic: '1A45DFA3' },
  { name: 'ASF / WMV', extension: 'wmv', mime: 'video/x-ms-asf', magic: '3026B2758E66CF11' },
  { name: 'FLV video', extension: 'flv', mime: 'video/x-flv', magic: '464C5601' },
  { name: 'MPEG program stream', extension: 'mpg', mime: 'video/mpeg', magic: '000001BA' },

  { name: 'ELF executable', extension: 'elf', mime: 'application/x-elf', magic: '7F454C46' },
  { name: 'DOS / Windows executable', extension: 'exe', mime: 'application/vnd.microsoft.portable-executable', magic: '4D5A' },
  { name: 'Mach-O 32 bit', extension: 'macho', mime: 'application/x-mach-binary', magic: 'FEEDFACE' },
  { name: 'Mach-O 64 bit', extension: 'macho', mime: 'application/x-mach-binary', magic: 'FEEDFACF' },
  { name: 'Mach-O universal', extension: 'macho', mime: 'application/x-mach-binary', magic: 'CAFEBABF' },
  { name: 'Java class file', extension: 'class', mime: 'application/java-vm', magic: 'CAFEBABE' },
  { name: 'WebAssembly module', extension: 'wasm', mime: 'application/wasm', magic: '0061736D' },
  { name: 'Python bytecode', extension: 'pyc', mime: 'application/x-python-code', magic: '????0D0A' },
  { name: 'Linux kernel image (ARM64)', extension: 'img', mime: 'application/octet-stream', magic: '????????41524D64', offset: 56 },
  { name: 'Android boot image', extension: 'img', mime: 'application/octet-stream', magic: '414E44524F494421' },
  { name: 'U-Boot image', extension: 'uimg', mime: 'application/octet-stream', magic: '27051956' },
  { name: 'Device tree blob', extension: 'dtb', mime: 'application/octet-stream', magic: 'D00DFEED' },
  { name: 'Intel HEX record', extension: 'hex', mime: 'text/plain', magic: '3A' },
  { name: 'Motorola S-Record', extension: 'srec', mime: 'text/plain', magic: '5330' },

  { name: 'SQLite database', extension: 'sqlite', mime: 'application/vnd.sqlite3', magic: '53514C69746520666F726D6174203300' },
  { name: 'Git pack file', extension: 'pack', mime: 'application/octet-stream', magic: '5041434B' },
  { name: 'PCAP capture', extension: 'pcap', mime: 'application/vnd.tcpdump.pcap', magic: 'D4C3B2A1' },
  { name: 'PCAPNG capture', extension: 'pcapng', mime: 'application/x-pcapng', magic: '0A0D0D0A' },
  { name: 'Windows registry hive', extension: 'dat', mime: 'application/octet-stream', magic: '72656766' },
  { name: 'Windows shortcut', extension: 'lnk', mime: 'application/x-ms-shortcut', magic: '4C00000001140200' },
  { name: 'DER certificate / key', extension: 'der', mime: 'application/x-x509-ca-cert', magic: '3082' },
  { name: 'PEM block', extension: 'pem', mime: 'application/x-pem-file', magic: '2D2D2D2D2D424547494E' },
  { name: 'OpenSSH private key', extension: 'key', mime: 'application/octet-stream', magic: '6F70656E7373682D6B65792D7631' },
  { name: 'BitTorrent file', extension: 'torrent', mime: 'application/x-bittorrent', magic: '64383A616E6E6F756E6365' },
  { name: 'TrueType font', extension: 'ttf', mime: 'font/ttf', magic: '0001000000' },
  { name: 'OpenType font', extension: 'otf', mime: 'font/otf', magic: '4F54544F' },
  { name: 'WOFF font', extension: 'woff', mime: 'font/woff', magic: '774F4646' },
  { name: 'WOFF2 font', extension: 'woff2', mime: 'font/woff2', magic: '774F4632' },
  { name: 'UTF-8 BOM text', extension: 'txt', mime: 'text/plain', magic: 'EFBBBF' },
  { name: 'UTF-16 LE BOM text', extension: 'txt', mime: 'text/plain', magic: 'FFFE' },
  { name: 'UTF-16 BE BOM text', extension: 'txt', mime: 'text/plain', magic: 'FEFF' },
  { name: 'Shell script', extension: 'sh', mime: 'text/x-shellscript', magic: '2321' },
  { name: 'Virtual hard disk (VHD)', extension: 'vhd', mime: 'application/octet-stream', magic: '636F6E6563746978' },
  { name: 'QEMU QCOW image', extension: 'qcow', mime: 'application/octet-stream', magic: '514649FB' },
  { name: 'VirtualBox disk image', extension: 'vdi', mime: 'application/octet-stream', magic: '3C3C3C20' },
  { name: 'Master boot record', extension: 'mbr', mime: 'application/octet-stream', magic: '55AA', offset: 510 },
]

interface CompiledSignature extends Signature {
  bytes: Array<number | null>
  strength: number
}

const compiled: CompiledSignature[] = SIGNATURES.map((signature) => {
  const bytes: Array<number | null> = []
  for (let i = 0; i < signature.magic.length; i += 2) {
    const pair = signature.magic.slice(i, i + 2)
    bytes.push(pair === '??' ? null : Number.parseInt(pair, 16))
  }
  return {
    ...signature,
    bytes,
    strength: bytes.filter((byte) => byte !== null).length,
  }
})

/** Returns every signature matching the given head of a file, best first. */
export function identify(head: Uint8Array): FormatMatch[] {
  const matches: FormatMatch[] = []
  for (const signature of compiled) {
    const offset = signature.offset ?? 0
    if (offset + signature.bytes.length > head.length) continue
    let ok = true
    for (let i = 0; i < signature.bytes.length; i++) {
      const expected = signature.bytes[i]
      if (expected !== null && head[offset + i] !== expected) {
        ok = false
        break
      }
    }
    if (!ok) continue
    matches.push({
      name: signature.name,
      extension: signature.extension,
      mime: signature.mime,
      offset,
      strength: signature.strength,
    })
  }
  return matches.sort((a, b) => b.strength - a.strength)
}

/** Best guess MIME type, used for the live preview and for downloads. */
export function guessMimeType(head: Uint8Array, fallback = 'application/octet-stream'): string {
  return identify(head)[0]?.mime ?? fallback
}
