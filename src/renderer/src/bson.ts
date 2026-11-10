import { EJSON, Document } from 'bson'

export { EJSON }

export function parseEjson<T = Document>(s: string): T {
  return EJSON.parse(s, { relaxed: false }) as unknown as T
}

export function toEjson(v: unknown): string {
  return EJSON.stringify(v as Document, { relaxed: false })
}

export function parseDocuments(s: string): Document[] {
  const v = parseEjson<unknown>(s)
  return Array.isArray(v) ? (v as Document[]) : v === null || v === undefined ? [] : [v as Document]
}
