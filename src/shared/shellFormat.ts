// Formats BSON values the way the mongo shell / Robo3T text view does:
//   ObjectId("..."), ISODate("..."), NumberLong(1), NumberDecimal("1.5"), BinData(0, "..."), etc.
// Works on values produced by either the `bson` or `mongodb` package by inspecting `_bsontype`,
// so it is safe to use from both the main process and the renderer.

export interface FormatOptions {
  indent?: number
  /** When set, collapse nested objects/arrays deeper than this to a single line */
  maxDepth?: number
}

type AnyObj = Record<string, unknown>

function isPlainObject(v: unknown): v is AnyObj {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function quote(s: string): string {
  return JSON.stringify(s)
}

export function bsonTypeName(v: unknown): string {
  if (v === null) return 'Null'
  if (v === undefined) return 'Undefined'
  if (Array.isArray(v)) return 'Array'
  switch (typeof v) {
    case 'string':
      return 'String'
    case 'boolean':
      return 'Boolean'
    case 'number':
      return Number.isInteger(v) ? 'Int32' : 'Double'
    case 'bigint':
      return 'Int64'
    case 'object':
      break
    default:
      return typeof v
  }
  const o = v as AnyObj
  if (Object.prototype.toString.call(v) === '[object Date]') return 'Date'
  if (Object.prototype.toString.call(v) === '[object RegExp]') return 'RegExp'
  const t = o._bsontype as string | undefined
  if (t) {
    switch (t) {
      case 'ObjectId':
      case 'ObjectID':
        return 'ObjectId'
      case 'Long':
        return 'Int64'
      case 'Int32':
        return 'Int32'
      case 'Double':
        return 'Double'
      case 'Decimal128':
        return 'Decimal128'
      case 'Binary':
        return (o as { sub_type?: number }).sub_type === 4 ? 'UUID' : 'Binary'
      case 'Timestamp':
        return 'Timestamp'
      case 'BSONRegExp':
        return 'RegExp'
      case 'Code':
        return 'Code'
      case 'MinKey':
        return 'MinKey'
      case 'MaxKey':
        return 'MaxKey'
      case 'DBRef':
        return 'DBRef'
      case 'BSONSymbol':
        return 'Symbol'
      default:
        return t
    }
  }
  return 'Object'
}

/** Single-line representation of a scalar (non-object/array) BSON value in shell syntax. */
export function formatScalar(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  switch (typeof v) {
    case 'string':
      return quote(v)
    case 'boolean':
    case 'number':
      return String(v)
    case 'bigint':
      return `NumberLong(${v})`
    case 'function':
      return v.toString()
    case 'object':
      break
    default:
      return String(v)
  }
  const o = v as AnyObj
  if (Object.prototype.toString.call(v) === '[object Date]') {
    const d = v as Date
    return isNaN(d.getTime()) ? 'ISODate("Invalid Date")' : `ISODate(${quote(d.toISOString())})`
  }
  if (Object.prototype.toString.call(v) === '[object RegExp]') return String(v)
  const t = o._bsontype as string | undefined
  switch (t) {
    case 'ObjectId':
    case 'ObjectID':
      return `ObjectId(${quote(String((o as { toHexString(): string }).toHexString()))})`
    case 'Long':
      return `NumberLong(${String(o)})`
    case 'Int32':
      return String((o as { value: number }).value)
    case 'Double':
      return String((o as { value: number }).value)
    case 'Decimal128':
      return `NumberDecimal(${quote(String(o))})`
    case 'Binary': {
      const b = o as { sub_type: number; buffer: Uint8Array; toString(enc?: string): string; toUUID?: () => { toHexString(): string } }
      if (b.sub_type === 4 && b.toUUID) {
        try {
          return `UUID(${quote(b.toUUID().toHexString())})`
        } catch {
          /* fall through */
        }
      }
      return `BinData(${b.sub_type}, ${quote(bytesToBase64(b.buffer))})`
    }
    case 'Timestamp': {
      const ts = o as { high: number; low: number; t?: number; i?: number }
      const t2 = ts.t ?? ts.high
      const i = ts.i ?? ts.low
      return `Timestamp(${t2}, ${i})`
    }
    case 'BSONRegExp': {
      const r = o as { pattern: string; options: string }
      return `/${r.pattern}/${r.options}`
    }
    case 'Code': {
      const c = o as { code: string; scope?: unknown }
      return c.scope ? `Code(${quote(c.code)}, ${formatShell(c.scope)})` : `Code(${quote(c.code)})`
    }
    case 'MinKey':
      return 'MinKey()'
    case 'MaxKey':
      return 'MaxKey()'
    case 'BSONSymbol':
      return `Symbol(${quote(String((o as { value: string }).value))})`
    case 'DBRef': {
      const r = o as { collection: string; oid: unknown; db?: string }
      return `DBRef(${quote(r.collection)}, ${formatScalar(r.oid)}${r.db ? `, ${quote(r.db)}` : ''})`
    }
  }
  return String(v)
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function isContainer(v: unknown): boolean {
  if (Array.isArray(v)) return true
  if (!isPlainObject(v)) return false
  return true
}

/** True for values that should render as expandable nodes in the tree view. */
export function isExpandable(v: unknown): boolean {
  return isContainer(v)
}

export function formatShell(v: unknown, opts: FormatOptions = {}, depth = 0): string {
  const indent = opts.indent ?? 4
  const pad = (n: number): string => ' '.repeat(indent * n)
  if (Array.isArray(v)) {
    if (v.length === 0) return '[ ]'
    if (opts.maxDepth !== undefined && depth >= opts.maxDepth) return `[ ${v.length} elements ]`
    const items = v.map((x) => pad(depth + 1) + formatShell(x, opts, depth + 1))
    return `[\n${items.join(',\n')}\n${pad(depth)}]`
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v)
    if (keys.length === 0) return '{ }'
    if (opts.maxDepth !== undefined && depth >= opts.maxDepth) return `{ ${keys.length} fields }`
    const items = keys.map((k) => `${pad(depth + 1)}${quote(k)} : ${formatShell(v[k], opts, depth + 1)}`)
    return `{\n${items.join(',\n')}\n${pad(depth)}}`
  }
  if (v && typeof v === 'object' && !(v as AnyObj)._bsontype && Object.prototype.toString.call(v) === '[object Object]') {
    // class instances we don't know: treat as plain
    return formatShell({ ...(v as AnyObj) }, opts, depth)
  }
  return formatScalar(v)
}

/** Compact single-line form used in table cells and collapsed tree nodes. */
export function formatInline(v: unknown, maxLen = 120): string {
  let s: string
  if (Array.isArray(v)) {
    s = `[ ${v.map((x) => formatInline(x, maxLen)).join(', ')} ]`
  } else if (isPlainObject(v)) {
    s = `{ ${Object.keys(v)
      .map((k) => `${k}: ${formatInline(v[k], maxLen)}`)
      .join(', ')} }`
  } else {
    s = formatScalar(v)
  }
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s
}

export function summarize(v: unknown): string {
  if (Array.isArray(v)) return `Array [${v.length}]`
  if (isPlainObject(v)) return `Object { ${Object.keys(v).length} fields }`
  return formatScalar(v)
}
