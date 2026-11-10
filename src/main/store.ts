import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { ConnectionConfig, AppSettings, defaultSettings, newConnectionConfig } from '@shared/types'

// Connections are persisted to userData/connections.json. The file is encrypted with the OS keychain
// via safeStorage when available so saved passwords aren't sitting on disk in plain text.

function connectionsPath(): string {
  return join(app.getPath('userData'), 'connections.json')
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readEncrypted<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path)
    const text = raw.subarray(0, 4).toString() === 'ENC:' ? safeStorage.decryptString(raw.subarray(4)) : raw.toString('utf8')
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

async function writeEncrypted(path: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2)
  await fs.mkdir(join(path, '..'), { recursive: true })
  if (safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(path, Buffer.concat([Buffer.from('ENC:'), safeStorage.encryptString(text)]))
  } else {
    await fs.writeFile(path, text, 'utf8')
  }
}

export async function listConnections(): Promise<ConnectionConfig[]> {
  const list = await readEncrypted<Partial<ConnectionConfig>[]>(connectionsPath(), [])
  return list.map((c) => newConnectionConfig(c))
}

export async function saveConnection(config: ConnectionConfig): Promise<ConnectionConfig> {
  const list = await listConnections()
  const saved = { ...config, id: config.id || randomUUID() }
  const idx = list.findIndex((c) => c.id === saved.id)
  if (idx >= 0) list[idx] = saved
  else list.push(saved)
  await writeEncrypted(connectionsPath(), list)
  return saved
}

export async function removeConnection(id: string): Promise<void> {
  const list = await listConnections()
  await writeEncrypted(connectionsPath(), list.filter((c) => c.id !== id))
}

export async function getSettings(): Promise<AppSettings> {
  return { ...defaultSettings, ...(await readEncrypted<Partial<AppSettings>>(settingsPath(), {})) }
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getSettings()), ...patch }
  // kept encrypted so the file format stays the same as earlier versions, which stored a token here
  await writeEncrypted(settingsPath(), next)
  return next
}
