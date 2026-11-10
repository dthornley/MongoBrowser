// Shared types for the main <-> renderer IPC contract.
// Anything that carries BSON values crosses the bridge as an EJSON (canonical) string.

export type ConnectionType = 'direct' | 'replicaSet' | 'uri'

export interface ReplicaMember {
  host: string
  port: number
}

export interface ConnectionConfig {
  id: string
  name: string
  type: ConnectionType
  host: string
  port: number
  members: ReplicaMember[]
  replicaSetName: string
  uri: string
  auth: {
    enabled: boolean
    database: string
    username: string
    password: string
    mechanism: '' | 'SCRAM-SHA-1' | 'SCRAM-SHA-256' | 'MONGODB-X509' | 'PLAIN' | 'MONGODB-AWS'
  }
  ssh: {
    enabled: boolean
    host: string
    port: number
    username: string
    method: 'password' | 'privateKey'
    password: string
    privateKeyPath: string
    passphrase: string
  }
  tls: {
    enabled: boolean
    caFile: string
    certFile: string
    keyFile: string
    keyPassword: string
    allowInvalidCertificates: boolean
    allowInvalidHostnames: boolean
  }
  advanced: {
    defaultDatabase: string
    connectTimeoutMs: number
    readPreference: '' | 'primary' | 'primaryPreferred' | 'secondary' | 'secondaryPreferred' | 'nearest'
  }
}

export function newConnectionConfig(partial: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: '',
    name: 'New Connection',
    type: 'direct',
    host: 'localhost',
    port: 27017,
    members: [],
    replicaSetName: '',
    uri: '',
    auth: { enabled: false, database: 'admin', username: '', password: '', mechanism: '' },
    ssh: {
      enabled: false,
      host: '',
      port: 22,
      username: '',
      method: 'password',
      password: '',
      privateKeyPath: '',
      passphrase: ''
    },
    tls: {
      enabled: false,
      caFile: '',
      certFile: '',
      keyFile: '',
      keyPassword: '',
      allowInvalidCertificates: false,
      allowInvalidHostnames: false
    },
    advanced: { defaultDatabase: '', connectTimeoutMs: 10000, readPreference: '' },
    ...partial
  }
}

export interface ServerInfo {
  version: string
  host: string
  replicaSet?: string
  isWritablePrimary: boolean
  topology: string
}

export interface DatabaseInfo {
  name: string
  sizeOnDisk: number
  empty: boolean
}

export interface CollectionInfo {
  name: string
  type: 'collection' | 'view' | 'timeseries' | string
  options?: Record<string, unknown>
  system: boolean
}

export interface QueryOptions {
  /** extra skip applied by the paging bar (added to the script's own skip) */
  skip: number
  /** page size used when the script does not call .limit() */
  limit: number
}

export type QueryResultKind = 'documents' | 'value' | 'empty'

export interface QueryResult {
  kind: QueryResultKind
  /** EJSON (canonical) string of an array of documents (for 'documents') or of the value (for 'value') */
  ejson: string
  /** number of documents in this page */
  count: number
  /** total matching documents when the result came from a find() cursor and counting was cheap */
  total?: number
  /** effective skip / limit used to produce this page (for cursors) */
  skip: number
  limit: number
  /** namespace of the collection the cursor came from (enables inline edit/delete) */
  namespace?: { db: string; collection: string }
  elapsedMs: number
  /** output from print()/printjson() calls in the script */
  output: string[]
  /** true when the script was a find/aggregate cursor so paging applies */
  pageable: boolean
}

export interface IndexInfo {
  name: string
  key: Record<string, unknown>
  unique?: boolean
  sparse?: boolean
  background?: boolean
  expireAfterSeconds?: number
  partialFilterExpression?: Record<string, unknown>
  size?: number
  raw: Record<string, unknown>
}

export interface UserInfo {
  _id: string
  user: string
  db: string
  roles: { role: string; db: string }[]
}

export interface CreateUserRequest {
  user: string
  pwd: string
  roles: { role: string; db: string }[]
}

export interface CreateIndexRequest {
  /** EJSON string of the key spec */
  keysEjson: string
  name?: string
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
  /** EJSON string of partial filter expression */
  partialFilterEjson?: string
}

export interface CreateCollectionRequest {
  name: string
  capped?: boolean
  size?: number
  max?: number
}

export interface ContextMenuItem {
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'submenu'
  enabled?: boolean
  submenu?: ContextMenuItem[]
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectionStatusEvent {
  connectionId: string
  state: ConnectionState
  error?: string
}

/** The API exposed to the renderer by the preload script */
export interface MongoBrowserApi {
  connections: {
    list(): Promise<ConnectionConfig[]>
    save(config: ConnectionConfig): Promise<ConnectionConfig>
    remove(id: string): Promise<void>
    test(config: ConnectionConfig): Promise<ServerInfo>
    /** Robo3T config files found in the usual places, newest first */
    findRobo3T(): Promise<string[]>
    previewRobo3T(path: string, keyPath?: string): Promise<Robo3TImportPreview>
  }
  session: {
    connect(id: string): Promise<ServerInfo>
    disconnect(id: string): Promise<void>
    onStatus(cb: (ev: ConnectionStatusEvent) => void): () => void
  }
  server: {
    databases(connectionId: string): Promise<DatabaseInfo[]>
    collections(connectionId: string, db: string): Promise<CollectionInfo[]>
    dbStats(connectionId: string, db: string): Promise<string>
    collectionStats(connectionId: string, db: string, collection: string): Promise<string>
    serverStatus(connectionId: string): Promise<string>
    hostInfo(connectionId: string): Promise<string>
    createDatabase(connectionId: string, db: string): Promise<void>
    dropDatabase(connectionId: string, db: string): Promise<void>
    createCollection(connectionId: string, db: string, req: CreateCollectionRequest): Promise<void>
    dropCollection(connectionId: string, db: string, collection: string): Promise<void>
    renameCollection(connectionId: string, db: string, collection: string, newName: string): Promise<void>
    copyCollection(
      connectionId: string,
      db: string,
      collection: string,
      targetConnectionId: string,
      targetDb: string,
      targetCollection: string
    ): Promise<number>
    indexes(connectionId: string, db: string, collection: string): Promise<IndexInfo[]>
    createIndex(connectionId: string, db: string, collection: string, req: CreateIndexRequest): Promise<string>
    dropIndex(connectionId: string, db: string, collection: string, name: string): Promise<void>
    users(connectionId: string, db: string): Promise<UserInfo[]>
    createUser(connectionId: string, db: string, req: CreateUserRequest): Promise<void>
    dropUser(connectionId: string, db: string, user: string): Promise<void>
    functions(connectionId: string, db: string): Promise<{ _id: string; value: string }[]>
  }
  query: {
    execute(connectionId: string, db: string, script: string, opts: QueryOptions): Promise<QueryResult>
    /** Evaluate shell-syntax text (e.g. `{ _id: ObjectId("...") }`) to a document; returns EJSON */
    evalDocument(text: string): Promise<string>
    insertDocument(connectionId: string, db: string, collection: string, docEjson: string): Promise<string>
    replaceDocument(connectionId: string, db: string, collection: string, docEjson: string): Promise<void>
    deleteDocument(connectionId: string, db: string, collection: string, idEjson: string): Promise<void>
  }
  ui: {
    contextMenu(items: ContextMenuItem[]): Promise<string | null>
    openFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>
    readFile(path: string): Promise<string>
    saveFile(defaultName: string, content: string): Promise<boolean>
    confirm(title: string, message: string, detail?: string): Promise<boolean>
    platform: string
  }
  settings: {
    get(): Promise<AppSettings>
    set(settings: Partial<AppSettings>): Promise<AppSettings>
  }
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<UpdateStatus>
    install(): Promise<void>
    openReleases(): Promise<void>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
}

export interface Robo3TImportPreview {
  path: string
  /** robo3t.key used to decrypt passwords, if found */
  keyPath?: string
  version: string
  connections: ConnectionConfig[]
  /** connections whose passwords could not be decrypted (imported without them) */
  missingSecrets: string[]
  /** true when encrypted fields exist but no key file was available */
  needsKey: boolean
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
  current: string
  latest?: string
  notes?: string
  url?: string
  percent?: number
  error?: string
}

export interface AppSettings {
  defaultPageSize: number
  defaultResultView: 'tree' | 'table' | 'text'
  autoExpandFirst: boolean
  fontSize: number
  checkUpdatesOnLaunch: boolean
}

export const defaultSettings: AppSettings = {
  defaultPageSize: 50,
  defaultResultView: 'tree',
  autoExpandFirst: true,
  fontSize: 13,
  checkUpdatesOnLaunch: true
}
