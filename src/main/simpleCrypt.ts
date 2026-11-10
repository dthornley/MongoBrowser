import { inflateSync } from 'zlib'

// Port of Qt "SimpleCrypt" (Andre Somers) decryption, which Robo3T 1.3+ uses to obfuscate
// passwords in robo3t.json. The 64-bit key is the decimal number stored in robo3t.key.
//
// Format (base64): [version=3][flags][payload]; payload is XOR-chained with the 8 key bytes,
// then: [1 random byte][2-byte CRC-16 (big-endian) | 20-byte SHA-1][optional qCompress data].

const FLAG_COMPRESSION = 0x01
const FLAG_CHECKSUM = 0x02
const FLAG_HASH = 0x04

const CRC_TBL = [0x0000, 0x1081, 0x2102, 0x3183, 0x4204, 0x5285, 0x6306, 0x7387, 0x8408, 0x9489, 0xa50a, 0xb58b, 0xc60c, 0xd78d, 0xe70e, 0xf78f]

/** Qt's nibble-table qChecksum as shipped in the Qt 5 builds Robo3T used. */
export function qChecksum(data: Uint8Array): number {
  let crc = 0xffff
  for (let c of data) {
    crc = ((crc >> 4) & 0x0fff) ^ CRC_TBL[(crc ^ c) & 15]
    c >>= 4
    crc = ((crc >> 4) & 0x0fff) ^ CRC_TBL[(crc ^ c) & 15]
  }
  return ~crc & 0xffff
}

/** Bit-wise CRC-16/X-25. Real Robo3T config files contain checksums produced by both this and
 *  qChecksum() above (different Robo3T releases, different Qt builds), so decryption accepts either. */
export function crc16X25(data: Uint8Array): number {
  let crc = 0xffff
  for (const b of data) {
    crc ^= b
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1
  }
  return (crc ^ 0xffff) & 0xffff
}

export function keyParts(key: bigint): number[] {
  const parts: number[] = []
  for (let i = 0; i < 8; i++) parts.push(Number((key >> BigInt(i * 8)) & 0xffn))
  return parts
}

export function parseKeyFile(text: string): bigint {
  const t = text.trim()
  if (!/^\d+$/.test(t)) throw new Error('robo3t.key does not contain a numeric key')
  return BigInt(t)
}

export function simpleCryptDecrypt(cipherBase64: string, key: bigint): string {
  if (!cipherBase64) return ''
  const buf = Buffer.from(cipherBase64, 'base64')
  if (buf.length < 3) throw new Error('cipher text too short')
  if (buf[0] !== 0x03) throw new Error(`unsupported SimpleCrypt version ${buf[0]}`)
  const flags = buf[1]
  const ba = Buffer.from(buf.subarray(2))
  const parts = keyParts(key)
  let last = 0
  for (let pos = 0; pos < ba.length; pos++) {
    const current = ba[pos]
    ba[pos] = ba[pos] ^ last ^ parts[pos % 8]
    last = current
  }
  let data = ba.subarray(1) // drop the random leading byte
  if (flags & FLAG_CHECKSUM) {
    const stored = data.readUInt16BE(0)
    data = data.subarray(2)
    if (qChecksum(data) !== stored && crc16X25(data) !== stored) throw new Error('checksum mismatch — wrong robo3t.key?')
  } else if (flags & FLAG_HASH) {
    const stored = data.subarray(0, 20)
    data = data.subarray(20)
    const { createHash } = require('crypto') as typeof import('crypto')
    if (!createHash('sha1').update(data).digest().equals(stored)) throw new Error('hash mismatch — wrong robo3t.key?')
  }
  if (flags & FLAG_COMPRESSION) data = Buffer.from(inflateSync(data.subarray(4))) // qCompress: 4-byte length prefix + zlib
  return data.toString('utf8')
}
