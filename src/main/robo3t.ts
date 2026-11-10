import { promises as fs } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { dirname } from 'path'
import { ConnectionConfig, Robo3TImportPreview, newConnectionConfig } from '@shared/types'
import { parseKeyFile, simpleCryptDecrypt } from './simpleCrypt'

// Reads Robo3T's connection file (~/.3T/robo-3t/<version>/robo3t.json, or older
// ~/.config/robomongo/<version>/robomongo.json) and converts each entry to a ConnectionConfig.
// Field names follow Robo3T's ConnectionSettings / CredentialSettings / SshSettings / SslSettings
// serialisation. Robo3T 1.3+ stores secrets as *Encrypted fields (SimpleCrypt, key in robo3t.key next
// to the version folders); older files hold them in the clear.

type Dict = Record<string, unknown>

interface Secrets {
  key?: bigint
  /** names of connections whose secrets could not be decrypted */
  failed: Set<string>
  needsKey: boolean
}

const str = (v: unknown, d = ''): string => (v === undefined || v === null ? d : String(v))
const num = (v: unknown, d: number): number => (typeof v === 'number' && !isNaN(v) ? v : Number(v) || d)
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1

/** Candidate config files, newest Robo3T version first. */
export async function findRobo3TConfigs(): Promise<string[]> {
  const found: string[] = []
  const roots = [join(homedir(), '.3T', 'robo-3t'), join(homedir(), '.config', 'robomongo')]
  for (const root of roots) {
    let versions: string[] = []
    try {
      versions = (await fs.readdir(root)).filter((v) => /^\d/.test(v))
    } catch {
      continue
    }
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const v of versions) {
      for (const name of ['robo3t.json', 'robomongo.json']) {
        const p = join(root, v, name)
        try {
          await fs.access(p)
          found.push(p)
        } catch {
          /* not here */
        }
      }
    }
  }
  return found
}

function splitHostPort(s: string, defaultPort: number): { host: string; port: number } {
  const m = /^(.*):(\d+)$/.exec(s.trim())
  return m ? { host: m[1], port: Number(m[2]) } : { host: s.trim(), port: defaultPort }
}

/** Locate robo3t.key for a given robo3t.json: next to it, or one directory up (the usual layout). */
export async function findKeyFile(configPath: string): Promise<string | undefined> {
  for (const dir of [dirname(configPath), dirname(dirname(configPath))]) {
    const p = join(dir, 'robo3t.key')
    try {
      await fs.access(p)
      return p
    } catch {
      /* keep looking */
    }
  }
  return undefined
}

/** Resolve a secret that may be stored plain (`field`) or encrypted (`fieldEncrypted`). */
function secret(obj: Dict, field: string, secrets: Secrets, owner: string): string {
  const plain = obj[field]
  if (typeof plain === 'string' && plain) return plain
  const enc = obj[`${field}Encrypted`]
  if (typeof enc !== 'string' || !enc) return ''
  if (secrets.key === undefined) {
    secrets.needsKey = true
    secrets.failed.add(owner)
    return ''
  }
  try {
    return simpleCryptDecrypt(enc, secrets.key)
  } catch {
    secrets.failed.add(owner)
    return ''
  }
}

function convert(raw: Dict, secrets: Secrets): ConnectionConfig {
  const cfg = newConnectionConfig({
    name: str(raw.connectionName, 'Imported connection'),
    host: str(raw.serverHost, 'localhost'),
    port: num(raw.serverPort, 27017)
  })
  cfg.advanced.defaultDatabase = str(raw.defaultDatabase)

  // replica set
  const rs = (raw.replicaSet as Dict) ?? {}
  const members = Array.isArray(rs.members) ? (rs.members as unknown[]).map((m) => splitHostPort(str(m), 27017)) : []
  if (bool(raw.isReplicaSet) && members.length) {
    cfg.type = 'replicaSet'
    cfg.members = members
    cfg.replicaSetName = str(rs.setName)
  }

  // credentials: Robo3T keeps a list but only ever uses the first enabled one
  const creds = Array.isArray(raw.credentials) ? (raw.credentials as Dict[]) : []
  const cred = creds.find((c) => bool(c.enabled)) ?? creds[0]
  if (cred && bool(cred.enabled)) {
    cfg.auth.enabled = true
    cfg.auth.username = str(cred.userName)
    cfg.auth.password = secret(cred, 'userPassword', secrets, cfg.name)
    cfg.auth.database = str(cred.databaseName, 'admin')
    const mech = str(cred.mechanism).toUpperCase()
    cfg.auth.mechanism = mech === 'SCRAM-SHA-1' || mech === 'SCRAM-SHA-256' || mech === 'MONGODB-X509' || mech === 'PLAIN' ? (mech as typeof cfg.auth.mechanism) : ''
    if (mech === 'MONGODB-CR') cfg.auth.mechanism = 'SCRAM-SHA-1'
  }

  // ssh
  const ssh = (raw.ssh as Dict) ?? {}
  if (bool(ssh.enabled)) {
    cfg.ssh.enabled = true
    cfg.ssh.host = str(ssh.host)
    cfg.ssh.port = num(ssh.port, 22)
    cfg.ssh.username = str(ssh.userName)
    const method = str(ssh.method, 'password').toLowerCase()
    if (method === 'publickey' || method === 'privatekey' || method === 'key') {
      cfg.ssh.method = 'privateKey'
      cfg.ssh.privateKeyPath = str(ssh.privateKeyFile)
      cfg.ssh.passphrase = secret(ssh, 'passphrase', secrets, cfg.name)
    } else {
      cfg.ssh.method = 'password'
      cfg.ssh.password = secret(ssh, 'userPassword', secrets, cfg.name)
    }
  }

  // ssl / tls
  const ssl = (raw.ssl as Dict) ?? {}
  if (bool(ssl.sslEnabled) || bool(ssl.enabled)) {
    cfg.tls.enabled = true
    cfg.tls.caFile = str(ssl.caFile)
    if (bool(ssl.usePemFile) || bool(ssl.useClientCert) || str(ssl.pemKeyFile)) {
      // Robo3T uses a single PEM holding both cert and key
      cfg.tls.certFile = str(ssl.pemKeyFile)
      cfg.tls.keyFile = str(ssl.pemKeyFile)
      cfg.tls.keyPassword = secret(ssl, 'pemPassPhrase', secrets, cfg.name)
    }
    cfg.tls.allowInvalidCertificates = bool(ssl.allowInvalidCertificates)
    cfg.tls.allowInvalidHostnames = bool(ssl.allowInvalidHostnames)
  }

  return cfg
}

export async function previewRobo3TImport(path: string, keyPath?: string): Promise<Robo3TImportPreview> {
  const text = await fs.readFile(path, 'utf8')
  const resolvedKey = keyPath || (await findKeyFile(path))
  const secrets: Secrets = { failed: new Set(), needsKey: false }
  if (resolvedKey) {
    try {
      secrets.key = parseKeyFile(await fs.readFile(resolvedKey, 'utf8'))
    } catch (err) {
      throw new Error(`Could not read ${resolvedKey}: ${(err as Error).message}`)
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not a valid Robo3T config file (expected JSON)')
  }
  const list = (parsed as Dict)?.connections
  if (!Array.isArray(list)) throw new Error('No "connections" array found — is this a robo3t.json file?')
  const connections = (list as Dict[]).map((raw) => convert(raw, secrets))
  return {
    path,
    keyPath: resolvedKey,
    version: str((parsed as Dict).version),
    connections,
    missingSecrets: [...secrets.failed],
    needsKey: secrets.needsKey
  }
}
