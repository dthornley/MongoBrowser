import vm from 'vm'
import * as acorn from 'acorn'
import {
  MongoClient,
  Db,
  Collection,
  Document,
  BSON,
  Filter,
  FindOptions,
  AggregateOptions,
  Sort,
  Long
} from 'mongodb'
import { QueryOptions, QueryResult } from '@shared/types'
import { formatShell } from '@shared/shellFormat'

const { ObjectId, Int32, Double, Decimal128, Timestamp, Binary, UUID, MinKey, MaxKey, DBRef, Code, BSONSymbol, BSONRegExp, EJSON } = BSON

type AnyDoc = Document

// ---------------------------------------------------------------------------------------------
// Shell cursor: lazily describes a find()/aggregate() so the paging bar can apply skip/limit
// afterwards, exactly like Robo3T re-running the query with a different skip.
// ---------------------------------------------------------------------------------------------
export class ShellCursor {
  _sort?: Sort
  _limit?: number
  _skip?: number
  _projection?: AnyDoc
  _hint?: string | AnyDoc
  _collation?: AnyDoc
  _maxTimeMS?: number
  _comment?: string
  _allowDiskUse?: boolean
  _batchSize?: number

  constructor(
    readonly collection: Collection,
    readonly kind: 'find' | 'aggregate',
    readonly filter: AnyDoc,
    readonly pipeline: AnyDoc[],
    readonly options: AnyDoc
  ) {
    if (options.projection) this._projection = options.projection as AnyDoc
    if (options.sort) this._sort = options.sort as Sort
    if (options.limit !== undefined) this._limit = Number(options.limit)
    if (options.skip !== undefined) this._skip = Number(options.skip)
    if (options.allowDiskUse !== undefined) this._allowDiskUse = Boolean(options.allowDiskUse)
  }

  sort(s: Sort): this {
    this._sort = s
    return this
  }
  limit(n: number): this {
    this._limit = Number(n)
    return this
  }
  skip(n: number): this {
    this._skip = Number(n)
    return this
  }
  projection(p: AnyDoc): this {
    this._projection = p
    return this
  }
  project(p: AnyDoc): this {
    return this.projection(p)
  }
  hint(h: string | AnyDoc): this {
    this._hint = h
    return this
  }
  collation(c: AnyDoc): this {
    this._collation = c
    return this
  }
  maxTimeMS(ms: number): this {
    this._maxTimeMS = ms
    return this
  }
  comment(c: string): this {
    this._comment = c
    return this
  }
  allowDiskUse(v = true): this {
    this._allowDiskUse = v
    return this
  }
  batchSize(n: number): this {
    this._batchSize = n
    return this
  }
  // no-ops kept for script compatibility
  pretty(): this {
    return this
  }
  noCursorTimeout(): this {
    return this
  }
  readPref(): this {
    return this
  }
  addOption(): this {
    return this
  }

  private findOptions(skip: number, limit: number | undefined): FindOptions {
    const o: FindOptions = { skip }
    if (limit !== undefined && limit > 0) o.limit = limit
    if (this._sort) o.sort = this._sort
    if (this._projection) o.projection = this._projection
    if (this._hint) o.hint = this._hint
    if (this._collation) o.collation = this._collation as FindOptions['collation']
    if (this._maxTimeMS) o.maxTimeMS = this._maxTimeMS
    if (this._comment) o.comment = this._comment
    if (this._batchSize) o.batchSize = this._batchSize
    return o
  }

  private aggregatePipeline(skip: number, limit: number | undefined): AnyDoc[] {
    const p = [...this.pipeline]
    if (this._sort) p.push({ $sort: this._sort })
    if (skip > 0) p.push({ $skip: skip })
    if (limit !== undefined && limit > 0) p.push({ $limit: limit })
    if (this._projection) p.push({ $project: this._projection })
    return p
  }

  private aggregateOptions(): AggregateOptions {
    const o: AggregateOptions = {}
    if (this._allowDiskUse !== undefined) o.allowDiskUse = this._allowDiskUse
    if (this._collation) o.collation = this._collation as AggregateOptions['collation']
    if (this._maxTimeMS) o.maxTimeMS = this._maxTimeMS
    if (this._hint) o.hint = this._hint
    if (this._comment) o.comment = this._comment
    return o
  }

  /** Fetch a page. `extraSkip`/`pageLimit` come from the UI paging bar. */
  async page(extraSkip: number, pageLimit: number): Promise<{ docs: AnyDoc[]; skip: number; limit: number }> {
    const skip = (this._skip ?? 0) + extraSkip
    const limit = this._limit !== undefined && this._limit > 0 ? this._limit : pageLimit
    const docs =
      this.kind === 'find'
        ? await this.collection.find(this.filter, this.findOptions(skip, limit)).toArray()
        : await this.collection.aggregate(this.aggregatePipeline(skip, limit), this.aggregateOptions()).toArray()
    return { docs, skip, limit }
  }

  async total(): Promise<number | undefined> {
    if (this.kind !== 'find') return undefined
    try {
      const opts: AnyDoc = { maxTimeMS: 3000 }
      if (this._hint) opts.hint = this._hint
      if (this._collation) opts.collation = this._collation
      return await this.collection.countDocuments(this.filter, opts)
    } catch {
      return undefined
    }
  }

  async toArray(): Promise<AnyDoc[]> {
    const skip = this._skip ?? 0
    return this.kind === 'find'
      ? this.collection.find(this.filter, this.findOptions(skip, this._limit)).toArray()
      : this.collection.aggregate(this.aggregatePipeline(skip, this._limit), this.aggregateOptions()).toArray()
  }
  async count(): Promise<number> {
    if (this.kind === 'find') return this.collection.countDocuments(this.filter)
    return (await this.toArray()).length
  }
  async size(): Promise<number> {
    return (await this.toArray()).length
  }
  async itcount(): Promise<number> {
    return this.size()
  }
  async forEach(fn: (d: AnyDoc) => unknown): Promise<void> {
    for (const d of await this.toArray()) await fn(d)
  }
  async map<T>(fn: (d: AnyDoc) => T): Promise<T[]> {
    return (await this.toArray()).map(fn)
  }
  async explain(verbosity: string | boolean = 'queryPlanner'): Promise<AnyDoc> {
    const v = verbosity === true ? 'executionStats' : verbosity === false ? 'queryPlanner' : verbosity
    const skip = this._skip ?? 0
    return this.kind === 'find'
      ? this.collection.find(this.filter, this.findOptions(skip, this._limit)).explain(v as never)
      : this.collection.aggregate(this.aggregatePipeline(skip, this._limit), this.aggregateOptions()).explain(v as never)
  }
  async hasNext(): Promise<boolean> {
    return (await this.toArray()).length > 0
  }
  async next(): Promise<AnyDoc | null> {
    return (await this.toArray())[0] ?? null
  }
  toString(): string {
    return `${this.collection.dbName}.${this.collection.collectionName}.${this.kind}(...)`
  }
}

// ---------------------------------------------------------------------------------------------
// Collection wrapper mirroring the legacy mongo shell collection API.
// ---------------------------------------------------------------------------------------------
class ShellCollection {
  constructor(
    readonly shellDb: ShellDb,
    readonly coll: Collection
  ) {}

  getName(): string {
    return this.coll.collectionName
  }
  getFullName(): string {
    return `${this.coll.dbName}.${this.coll.collectionName}`
  }
  getDB(): ShellDb {
    return this.shellDb
  }
  toString(): string {
    return this.getFullName()
  }

  find(filter: AnyDoc = {}, projection?: AnyDoc, options: AnyDoc = {}): ShellCursor {
    const opts = { ...options }
    if (projection) opts.projection = projection
    return new ShellCursor(this.coll, 'find', filter ?? {}, [], opts)
  }
  findOne(filter: AnyDoc = {}, projection?: AnyDoc, options: AnyDoc = {}): Promise<AnyDoc | null> {
    const opts: FindOptions = { ...(options as FindOptions) }
    if (projection) opts.projection = projection
    return this.coll.findOne(filter ?? {}, opts)
  }
  aggregate(pipeline: AnyDoc[] | AnyDoc = [], options: AnyDoc = {}): ShellCursor {
    const p = Array.isArray(pipeline) ? pipeline : [pipeline]
    return new ShellCursor(this.coll, 'aggregate', {}, p, options)
  }
  count(filter: AnyDoc = {}, options?: AnyDoc): Promise<number> {
    return this.coll.countDocuments(filter, options)
  }
  countDocuments(filter: AnyDoc = {}, options?: AnyDoc): Promise<number> {
    return this.coll.countDocuments(filter, options)
  }
  estimatedDocumentCount(): Promise<number> {
    return this.coll.estimatedDocumentCount()
  }
  distinct(key: string, filter: AnyDoc = {}, options: AnyDoc = {}): Promise<unknown[]> {
    return this.coll.distinct(key, filter, options)
  }

  insert(doc: AnyDoc | AnyDoc[], options?: AnyDoc): Promise<unknown> {
    return Array.isArray(doc) ? this.insertMany(doc, options) : this.insertOne(doc, options)
  }
  async insertOne(doc: AnyDoc, options?: AnyDoc): Promise<AnyDoc> {
    const r = await this.coll.insertOne(doc, options)
    return { acknowledged: r.acknowledged, insertedId: r.insertedId }
  }
  async insertMany(docs: AnyDoc[], options?: AnyDoc): Promise<AnyDoc> {
    const r = await this.coll.insertMany(docs, options)
    return { acknowledged: r.acknowledged, insertedIds: r.insertedIds }
  }
  save(doc: AnyDoc): Promise<unknown> {
    if (doc._id === undefined) return this.insertOne(doc)
    return this.coll.replaceOne({ _id: doc._id }, doc, { upsert: true }).then(writeResult)
  }

  update(filter: AnyDoc, update: AnyDoc, options: AnyDoc = {}): Promise<AnyDoc> {
    const multi = Boolean(options.multi)
    const opts = { ...options }
    delete opts.multi
    return multi ? this.updateMany(filter, update, opts) : this.updateOne(filter, update, opts)
  }
  async updateOne(filter: AnyDoc, update: AnyDoc | AnyDoc[], options?: AnyDoc): Promise<AnyDoc> {
    if (!Array.isArray(update) && !hasOperators(update)) return this.replaceOne(filter, update, options)
    return writeResult(await this.coll.updateOne(filter, update, options))
  }
  async updateMany(filter: AnyDoc, update: AnyDoc | AnyDoc[], options?: AnyDoc): Promise<AnyDoc> {
    return writeResult(await this.coll.updateMany(filter, update, options))
  }
  async replaceOne(filter: AnyDoc, doc: AnyDoc, options?: AnyDoc): Promise<AnyDoc> {
    return writeResult(await this.coll.replaceOne(filter, doc, options))
  }

  remove(filter: AnyDoc, options: AnyDoc | boolean = {}): Promise<AnyDoc> {
    const justOne = typeof options === 'boolean' ? options : Boolean(options.justOne)
    return justOne ? this.deleteOne(filter) : this.deleteMany(filter)
  }
  async deleteOne(filter: AnyDoc, options?: AnyDoc): Promise<AnyDoc> {
    const r = await this.coll.deleteOne(filter, options)
    return { acknowledged: r.acknowledged, deletedCount: r.deletedCount }
  }
  async deleteMany(filter: AnyDoc, options?: AnyDoc): Promise<AnyDoc> {
    const r = await this.coll.deleteMany(filter, options)
    return { acknowledged: r.acknowledged, deletedCount: r.deletedCount }
  }

  findOneAndUpdate(filter: AnyDoc, update: AnyDoc, options: AnyDoc = {}): Promise<AnyDoc | null> {
    return this.coll.findOneAndUpdate(filter, update, { ...options, includeResultMetadata: false })
  }
  findOneAndReplace(filter: AnyDoc, doc: AnyDoc, options: AnyDoc = {}): Promise<AnyDoc | null> {
    return this.coll.findOneAndReplace(filter, doc, { ...options, includeResultMetadata: false })
  }
  findOneAndDelete(filter: AnyDoc, options: AnyDoc = {}): Promise<AnyDoc | null> {
    return this.coll.findOneAndDelete(filter, { ...options, includeResultMetadata: false })
  }
  findAndModify(spec: AnyDoc): Promise<AnyDoc | null> {
    const opts: AnyDoc = { sort: spec.sort, upsert: spec.upsert, returnDocument: spec.new ? 'after' : 'before', projection: spec.fields }
    if (spec.remove) return this.findOneAndDelete(spec.query ?? {}, opts)
    return this.findOneAndUpdate(spec.query ?? {}, spec.update, opts)
  }
  async bulkWrite(ops: AnyDoc[], options?: AnyDoc): Promise<AnyDoc> {
    const r = await this.coll.bulkWrite(ops as never, options)
    return {
      insertedCount: r.insertedCount,
      matchedCount: r.matchedCount,
      modifiedCount: r.modifiedCount,
      deletedCount: r.deletedCount,
      upsertedCount: r.upsertedCount,
      upsertedIds: r.upsertedIds,
      insertedIds: r.insertedIds
    }
  }

  createIndex(keys: AnyDoc, options?: AnyDoc): Promise<string> {
    return this.coll.createIndex(keys, options)
  }
  ensureIndex(keys: AnyDoc, options?: AnyDoc): Promise<string> {
    return this.createIndex(keys, options)
  }
  createIndexes(specs: AnyDoc[], options?: AnyDoc): Promise<string[]> {
    return this.coll.createIndexes(specs.map((key) => ({ key })), options)
  }
  getIndexes(): Promise<AnyDoc[]> {
    return this.coll.indexes()
  }
  getIndexKeys(): Promise<AnyDoc[]> {
    return this.coll.indexes().then((ix) => ix.map((i) => i.key))
  }
  async dropIndex(nameOrKeys: string | AnyDoc): Promise<AnyDoc> {
    if (typeof nameOrKeys === 'string') return this.coll.dropIndex(nameOrKeys)
    const match = (await this.coll.indexes()).find((i) => JSON.stringify(i.key) === JSON.stringify(nameOrKeys))
    if (!match) throw new Error(`index not found with key spec ${JSON.stringify(nameOrKeys)}`)
    return this.coll.dropIndex(String(match.name))
  }
  async dropIndexes(): Promise<AnyDoc> {
    const ok = await this.coll.dropIndexes()
    return { ok: ok ? 1 : 0 }
  }
  reIndex(): Promise<AnyDoc> {
    return this.coll.db.command({ reIndex: this.coll.collectionName })
  }
  totalIndexSize(): Promise<number> {
    return this.stats().then((s) => Number(s.totalIndexSize ?? 0))
  }

  drop(): Promise<boolean> {
    return this.coll.drop()
  }
  renameCollection(newName: string, dropTarget = false): Promise<unknown> {
    return this.coll.rename(newName, { dropTarget })
  }
  stats(options?: AnyDoc): Promise<AnyDoc> {
    return this.coll.db.command({ collStats: this.coll.collectionName, ...(options ?? {}) })
  }
  dataSize(): Promise<number> {
    return this.stats().then((s) => Number(s.size ?? 0))
  }
  storageSize(): Promise<number> {
    return this.stats().then((s) => Number(s.storageSize ?? 0))
  }
  totalSize(): Promise<number> {
    return this.stats().then((s) => Number(s.storageSize ?? 0) + Number(s.totalIndexSize ?? 0))
  }
  isCapped(): Promise<boolean> {
    return this.coll.isCapped()
  }
  validate(full = false): Promise<AnyDoc> {
    return this.coll.db.command({ validate: this.coll.collectionName, full })
  }
  latencyStats(options?: AnyDoc): ShellCursor {
    return this.aggregate([{ $collStats: { latencyStats: options ?? {} } }])
  }
  getShardDistribution(): Promise<AnyDoc> {
    return this.stats()
  }
  watch(): never {
    throw new Error('watch() is not supported in a query tab')
  }
  mapReduce(map: unknown, reduce: unknown, options: AnyDoc = {}): Promise<AnyDoc> {
    return this.coll.db.command({ mapReduce: this.coll.collectionName, map, reduce, ...options })
  }
}

function hasOperators(doc: AnyDoc): boolean {
  return Object.keys(doc).some((k) => k.startsWith('$'))
}

function writeResult(r: { acknowledged: boolean; matchedCount: number; modifiedCount: number; upsertedCount: number; upsertedId: unknown }): AnyDoc {
  const out: AnyDoc = { acknowledged: r.acknowledged, matchedCount: r.matchedCount, modifiedCount: r.modifiedCount, upsertedCount: r.upsertedCount }
  if (r.upsertedId) out.upsertedId = r.upsertedId
  return out
}

// ---------------------------------------------------------------------------------------------
// Database wrapper. Returned through a Proxy so `db.anyCollectionName` resolves to a collection.
// ---------------------------------------------------------------------------------------------
export class ShellDb {
  readonly db: Db
  private collections = new Map<string, ShellCollection>()

  constructor(
    readonly client: MongoClient,
    readonly name: string
  ) {
    this.db = client.db(name)
  }

  getName(): string {
    return this.name
  }
  toString(): string {
    return this.name
  }
  getMongo(): { getDB: (n: string) => ShellDb } {
    return { getDB: (n: string) => wrapDb(new ShellDb(this.client, n)) }
  }
  getSiblingDB(n: string): ShellDb {
    return wrapDb(new ShellDb(this.client, n))
  }
  getCollection(n: string): ShellCollection {
    let c = this.collections.get(n)
    if (!c) {
      c = new ShellCollection(wrapDb(this), this.db.collection(n))
      this.collections.set(n, c)
    }
    return c
  }
  async getCollectionNames(): Promise<string[]> {
    const infos = await this.db.listCollections({}, { nameOnly: true }).toArray()
    return infos.map((i) => i.name).sort()
  }
  getCollectionInfos(filter?: AnyDoc): Promise<AnyDoc[]> {
    return this.db.listCollections(filter ?? {}).toArray()
  }
  createCollection(n: string, options?: AnyDoc): Promise<AnyDoc> {
    return this.db.createCollection(n, options).then(() => ({ ok: 1 }))
  }
  createView(n: string, source: string, pipeline: AnyDoc[], options?: AnyDoc): Promise<AnyDoc> {
    return this.db.createCollection(n, { viewOn: source, pipeline, ...(options ?? {}) }).then(() => ({ ok: 1 }))
  }
  dropDatabase(): Promise<boolean> {
    return this.db.dropDatabase()
  }
  runCommand(cmd: AnyDoc | string): Promise<AnyDoc> {
    return this.db.command(typeof cmd === 'string' ? { [cmd]: 1 } : cmd)
  }
  adminCommand(cmd: AnyDoc | string): Promise<AnyDoc> {
    return this.client.db('admin').command(typeof cmd === 'string' ? { [cmd]: 1 } : cmd)
  }
  stats(scale?: number): Promise<AnyDoc> {
    return this.db.stats(scale ? { scale } : undefined)
  }
  serverStatus(options?: AnyDoc): Promise<AnyDoc> {
    return this.adminCommand({ serverStatus: 1, ...(options ?? {}) })
  }
  serverBuildInfo(): Promise<AnyDoc> {
    return this.adminCommand({ buildInfo: 1 })
  }
  async version(): Promise<string> {
    return String((await this.serverBuildInfo()).version)
  }
  hostInfo(): Promise<AnyDoc> {
    return this.adminCommand({ hostInfo: 1 })
  }
  isMaster(): Promise<AnyDoc> {
    return this.runCommand({ hello: 1 })
  }
  hello(): Promise<AnyDoc> {
    return this.runCommand({ hello: 1 })
  }
  currentOp(filter?: AnyDoc): Promise<AnyDoc> {
    return this.adminCommand({ currentOp: 1, ...(filter ?? {}) })
  }
  killOp(opId: number): Promise<AnyDoc> {
    return this.adminCommand({ killOp: 1, op: opId })
  }
  listCommands(): Promise<AnyDoc> {
    return this.runCommand({ listCommands: 1 })
  }
  getLastError(): Promise<null> {
    return Promise.resolve(null)
  }
  getLastErrorObj(): Promise<AnyDoc> {
    return Promise.resolve({ ok: 1 })
  }
  getProfilingStatus(): Promise<AnyDoc> {
    return this.runCommand({ profile: -1 })
  }
  setProfilingLevel(level: number, slowms?: number): Promise<AnyDoc> {
    return this.runCommand({ profile: level, ...(slowms !== undefined ? { slowms } : {}) })
  }
  getUsers(): Promise<AnyDoc[]> {
    return this.runCommand({ usersInfo: 1 }).then((r) => (r.users as AnyDoc[]) ?? [])
  }
  getUser(name: string): Promise<AnyDoc | null> {
    return this.runCommand({ usersInfo: name }).then((r) => ((r.users as AnyDoc[]) ?? [])[0] ?? null)
  }
  createUser(user: AnyDoc): Promise<AnyDoc> {
    const { user: name, pwd, roles, ...rest } = user
    return this.runCommand({ createUser: name, pwd, roles: roles ?? [], ...rest })
  }
  updateUser(name: string, update: AnyDoc): Promise<AnyDoc> {
    return this.runCommand({ updateUser: name, ...update })
  }
  dropUser(name: string): Promise<AnyDoc> {
    return this.runCommand({ dropUser: name })
  }
  dropAllUsers(): Promise<AnyDoc> {
    return this.runCommand({ dropAllUsersFromDatabase: 1 })
  }
  changeUserPassword(name: string, pwd: string): Promise<AnyDoc> {
    return this.runCommand({ updateUser: name, pwd })
  }
  grantRolesToUser(name: string, roles: unknown[]): Promise<AnyDoc> {
    return this.runCommand({ grantRolesToUser: name, roles })
  }
  revokeRolesFromUser(name: string, roles: unknown[]): Promise<AnyDoc> {
    return this.runCommand({ revokeRolesFromUser: name, roles })
  }
  getRoles(options?: AnyDoc): Promise<AnyDoc[]> {
    return this.runCommand({ rolesInfo: 1, ...(options ?? {}) }).then((r) => (r.roles as AnyDoc[]) ?? [])
  }
  createRole(role: AnyDoc): Promise<AnyDoc> {
    const { role: name, ...rest } = role
    return this.runCommand({ createRole: name, ...rest })
  }
  dropRole(name: string): Promise<AnyDoc> {
    return this.runCommand({ dropRole: name })
  }
  auth(): never {
    throw new Error('Authenticate from the connection settings instead of db.auth()')
  }
  logout(): Promise<AnyDoc> {
    return Promise.resolve({ ok: 1 })
  }
  async printCollectionStats(): Promise<AnyDoc> {
    const names = await this.getCollectionNames()
    const out: AnyDoc = {}
    for (const n of names) out[n] = await this.getCollection(n).stats()
    return out
  }
}

const SHELLDB_PROPS = new Set(Object.getOwnPropertyNames(ShellDb.prototype))

/** Wrap a ShellDb so unknown property reads resolve to collections (db.users, db["my.coll"]). */
export function wrapDb(shellDb: ShellDb): ShellDb {
  if ((shellDb as unknown as { __proxied?: boolean }).__proxied) return shellDb
  const proxy = new Proxy(shellDb, {
    get(target, prop, receiver) {
      if (prop === '__proxied') return true
      if (typeof prop === 'symbol' || SHELLDB_PROPS.has(prop) || prop in target || prop === 'then' || prop === 'toJSON') {
        return Reflect.get(target, prop, receiver)
      }
      return target.getCollection(prop)
    },
    has(target, prop) {
      return typeof prop === 'symbol' ? prop in target : true
    }
  })
  return proxy
}

// ---------------------------------------------------------------------------------------------
// Shell globals: constructors that behave like the mongo shell's helpers (callable with or without `new`).
// ---------------------------------------------------------------------------------------------
function callable<T extends object>(ctor: new (...a: never[]) => T, make: (...a: unknown[]) => T): (...a: unknown[]) => T {
  const fn = function (this: unknown, ...a: unknown[]): T {
    return make(...a)
  }
  fn.prototype = ctor.prototype
  Object.setPrototypeOf(fn, ctor)
  return fn
}

export function shellGlobals(): Record<string, unknown> {
  const ObjectIdFn = callable(ObjectId, (id?: unknown) => new ObjectId(id as string | undefined))
  ;(ObjectIdFn as unknown as { isValid: typeof ObjectId.isValid }).isValid = ObjectId.isValid.bind(ObjectId)

  const ISODate = (s?: unknown): Date => {
    if (s === undefined) return new Date()
    const str = String(s)
    // the shell accepts dates without a timezone and treats them as UTC
    const d = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(str) ? new Date(str + (str.length > 10 ? 'Z' : 'T00:00:00Z')) : new Date(str)
    if (isNaN(d.getTime())) throw new Error(`Invalid ISO date: ${str}`)
    return d
  }

  return {
    ObjectId: ObjectIdFn,
    ObjectID: ObjectIdFn,
    ISODate,
    Date,
    RegExp,
    NumberLong: callable(Long, (v?: unknown) => (typeof v === 'string' ? Long.fromString(v) : Long.fromNumber(Number(v ?? 0)))),
    NumberInt: callable(Int32, (v?: unknown) => new Int32(Number(v ?? 0))),
    NumberDecimal: callable(Decimal128, (v?: unknown) => Decimal128.fromString(String(v ?? '0'))),
    Double: callable(Double, (v?: unknown) => new Double(Number(v ?? 0))),
    Timestamp: callable(Timestamp, (t?: unknown, i?: unknown) =>
      t === undefined ? new Timestamp({ t: Math.floor(Date.now() / 1000), i: 1 }) : new Timestamp({ t: Number(t), i: Number(i ?? 0) })
    ),
    BinData: (subtype: unknown, base64: unknown) => new Binary(Buffer.from(String(base64), 'base64'), Number(subtype)),
    HexData: (subtype: unknown, hex: unknown) => new Binary(Buffer.from(String(hex), 'hex'), Number(subtype)),
    UUID: callable(UUID, (s?: unknown) => (s === undefined ? new UUID() : new UUID(String(s)))),
    MinKey: callable(MinKey, () => new MinKey()),
    MaxKey: callable(MaxKey, () => new MaxKey()),
    DBRef: callable(DBRef, (c: unknown, oid: unknown, db?: unknown) => new DBRef(String(c), oid as never, db as string | undefined)),
    Code: callable(Code, (code: unknown, scope?: unknown) => new Code(String(code), scope as AnyDoc | undefined)),
    Symbol: callable(BSONSymbol, (v: unknown) => new BSONSymbol(String(v))),
    BSONRegExp,
    EJSON,
    tojson: (v: unknown, _indent?: unknown, _nolint?: unknown, _depth?: unknown) => formatShell(v),
    tojsononeline: (v: unknown) => formatShell(v).replace(/\s*\n\s*/g, ' '),
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    Error,
    TypeError,
    RangeError,
    Map,
    Set,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: undefined,
    sleep: (ms: unknown) => new Promise((r) => setTimeout(r, Number(ms)))
  }
}

// ---------------------------------------------------------------------------------------------
// Script preparation: translate shell-only syntax (`use db`, `show collections`) and turn the last
// expression statement into the return value, then wrap in an async IIFE so `await` works.
// ---------------------------------------------------------------------------------------------
function preprocess(script: string): string {
  return script
    .split('\n')
    .map((line) => {
      const use = /^\s*use\s+([\w.$-]+)\s*;?\s*$/.exec(line)
      if (use) return `db = db.getSiblingDB(${JSON.stringify(use[1])});`
      const show = /^\s*show\s+(dbs|databases|collections|tables|users|roles|profile|logs?)\s*;?\s*$/.exec(line)
      if (show) {
        switch (show[1]) {
          case 'dbs':
          case 'databases':
            return `(await db.adminCommand({ listDatabases: 1 })).databases;`
          case 'collections':
          case 'tables':
            return `db.getCollectionNames();`
          case 'users':
            return `db.getUsers();`
          case 'roles':
            return `db.getRoles({ showBuiltinRoles: false });`
          case 'profile':
            return `db.system.profile.find().sort({ ts: -1 }).limit(5);`
          default:
            return `db.adminCommand({ getLog: '*' });`
        }
      }
      return line
    })
    .join('\n')
}

export function prepareScript(script: string): string {
  const src = preprocess(script)
  let ast: acorn.Program
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, sourceType: 'script' })
  } catch (e) {
    const err = e as { message: string; loc?: { line: number; column: number } }
    throw new Error(`SyntaxError: ${err.message.replace(/\s*\(\d+:\d+\)$/, '')}${err.loc ? ` at line ${err.loc.line}` : ''}`)
  }
  const body = ast.body
  const last = body[body.length - 1]
  let transformed = src
  if (last && last.type === 'ExpressionStatement') {
    const expr = last.expression
    transformed = src.slice(0, expr.start) + 'return (' + src.slice(expr.start, expr.end) + ')' + src.slice(expr.end)
  }
  return `(async () => {\n${transformed}\n})()`
}

// ---------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------
function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as { then?: unknown }).then === 'function'
}

export async function runScript(client: MongoClient, dbName: string, script: string, opts: QueryOptions): Promise<QueryResult> {
  const started = Date.now()
  const output: string[] = []
  const print = (...args: unknown[]): void => {
    output.push(args.map((a) => (typeof a === 'string' ? a : formatShell(a))).join(' '))
  }
  const sandbox: Record<string, unknown> = {
    ...shellGlobals(),
    db: wrapDb(new ShellDb(client, dbName)),
    print,
    printjson: (v: unknown) => output.push(formatShell(v)),
    console: { log: print, info: print, warn: print, error: print }
  }
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })
  const code = prepareScript(script)
  let value: unknown = vm.runInContext(code, context, { filename: 'query.js', timeout: 30000 })
  if (isThenable(value)) value = await value

  if (value instanceof ShellCursor) {
    const [{ docs, skip, limit }, total] = await Promise.all([value.page(opts.skip, opts.limit), value.total()])
    return {
      kind: 'documents',
      ejson: EJSON.stringify(docs, { relaxed: false }),
      count: docs.length,
      total,
      skip,
      limit,
      namespace: { db: value.collection.dbName, collection: value.collection.collectionName },
      elapsedMs: Date.now() - started,
      output,
      pageable: true
    }
  }
  if (value === undefined) {
    return { kind: 'empty', ejson: 'null', count: 0, skip: 0, limit: 0, elapsedMs: Date.now() - started, output, pageable: false }
  }
  if (Array.isArray(value) && value.every((d) => d && typeof d === 'object' && !Array.isArray(d))) {
    return {
      kind: 'documents',
      ejson: EJSON.stringify(value, { relaxed: false }),
      count: value.length,
      skip: 0,
      limit: 0,
      elapsedMs: Date.now() - started,
      output,
      pageable: false
    }
  }
  return {
    kind: 'value',
    ejson: EJSON.stringify(sanitize(value), { relaxed: false }),
    count: 1,
    skip: 0,
    limit: 0,
    elapsedMs: Date.now() - started,
    output,
    pageable: false
  }
}

/** Make arbitrary values EJSON-safe (functions, class instances, etc). */
function sanitize(v: unknown): unknown {
  if (typeof v === 'function') return v.toString()
  if (v instanceof ShellCollection || v instanceof ShellDb) return v.toString()
  if (typeof v === 'bigint') return Long.fromBigInt(v)
  return v
}

/** Evaluate shell-syntax document text such as `{ _id: ObjectId("..."), when: ISODate("...") }`. */
export function evalDocument(text: string): unknown {
  const context = vm.createContext({ ...shellGlobals() }, { codeGeneration: { strings: false, wasm: false } })
  const trimmed = text.trim()
  return vm.runInContext(`(${trimmed})`, context, { filename: 'document.js', timeout: 5000 })
}
