import { ipcMain, BrowserWindow, Menu, MenuItemConstructorOptions, dialog } from 'electron'
import { promises as fs } from 'fs'
import { BSON, Document } from 'mongodb'
import { ClientManager } from './mongo/ClientManager'
import { runScript, evalDocument } from './mongo/shell'
import * as store from './store'
import * as updater from './updater'
import { findRobo3TConfigs, previewRobo3TImport } from './robo3t'
import {
  ConnectionConfig,
  ContextMenuItem,
  CreateCollectionRequest,
  CreateIndexRequest,
  CreateUserRequest,
  IndexInfo,
  QueryOptions,
  UserInfo
} from '@shared/types'

const { EJSON } = BSON

const ej = (v: unknown): string => EJSON.stringify(v as Document, { relaxed: false })
const parse = (s: string): Document => EJSON.parse(s, { relaxed: false }) as Document

/** Wrap a handler so thrown errors reach the renderer as plain messages instead of opaque IPC errors. */
function handle(channel: string, fn: (...args: never[]) => Promise<unknown> | unknown): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as never[]))
    } catch (err) {
      const e = err as { message?: string; codeName?: string; code?: unknown }
      const msg = e?.message ?? String(err)
      throw new Error(e?.codeName ? `${msg} (${e.codeName})` : msg)
    }
  })
}

export function registerIpc(clients: ClientManager, getWindow: () => BrowserWindow | null): void {
  clients.on('status', (ev) => getWindow()?.webContents.send('session:status', ev))

  // ---- connections -----------------------------------------------------------------------
  handle('connections:list', () => store.listConnections())
  handle('connections:save', (c: ConnectionConfig) => store.saveConnection(c))
  handle('connections:remove', async (id: string) => {
    await clients.disconnect(id)
    await store.removeConnection(id)
  })
  handle('connections:test', (c: ConnectionConfig) => clients.test(c))
  handle('connections:findRobo3T', () => findRobo3TConfigs())
  handle('connections:previewRobo3T', (path: string, keyPath?: string) => previewRobo3TImport(path, keyPath))

  // ---- session ---------------------------------------------------------------------------
  handle('session:connect', async (id: string) => {
    const config = (await store.listConnections()).find((c) => c.id === id)
    if (!config) throw new Error('Connection not found')
    return clients.connect(config)
  })
  handle('session:disconnect', (id: string) => clients.disconnect(id))

  // ---- server / admin --------------------------------------------------------------------
  handle('server:databases', async (id: string) => {
    const { client } = clients.get(id)
    const r = await client.db('admin').command({ listDatabases: 1 })
    return (r.databases as Document[])
      .map((d) => ({ name: String(d.name), sizeOnDisk: Number(d.sizeOnDisk ?? 0), empty: Boolean(d.empty) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
  handle('server:collections', async (id: string, db: string) => {
    const { client } = clients.get(id)
    const infos = await client.db(db).listCollections().toArray()
    return infos
      .map((i) => ({
        name: i.name,
        type: i.type ?? 'collection',
        options: 'options' in i ? (i.options as Record<string, unknown>) : undefined,
        system: i.name.startsWith('system.')
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
  handle('server:dbStats', async (id: string, db: string) => ej(await clients.get(id).client.db(db).stats()))
  handle('server:collectionStats', async (id: string, db: string, coll: string) =>
    ej(await clients.get(id).client.db(db).command({ collStats: coll }))
  )
  handle('server:serverStatus', async (id: string) => ej(await clients.get(id).client.db('admin').command({ serverStatus: 1 })))
  handle('server:hostInfo', async (id: string) => ej(await clients.get(id).client.db('admin').command({ hostInfo: 1 })))
  handle('server:createDatabase', async (id: string, db: string) => {
    // MongoDB creates databases lazily; Robo3T does the same trick of creating a placeholder collection.
    await clients.get(id).client.db(db).createCollection('placeholder')
  })
  handle('server:dropDatabase', async (id: string, db: string) => {
    await clients.get(id).client.db(db).dropDatabase()
  })
  handle('server:createCollection', async (id: string, db: string, req: CreateCollectionRequest) => {
    const opts: Document = {}
    if (req.capped) {
      opts.capped = true
      opts.size = req.size
      if (req.max) opts.max = req.max
    }
    await clients.get(id).client.db(db).createCollection(req.name, opts)
  })
  handle('server:dropCollection', async (id: string, db: string, coll: string) => {
    await clients.get(id).client.db(db).collection(coll).drop()
  })
  handle('server:renameCollection', async (id: string, db: string, coll: string, newName: string) => {
    await clients.get(id).client.db(db).collection(coll).rename(newName)
  })
  handle('server:copyCollection', async (id: string, db: string, coll: string, targetId: string, targetDb: string, targetColl: string) => {
    const source = clients.get(id).client.db(db).collection(coll)
    const target = clients.get(targetId).client.db(targetDb).collection(targetColl)
    let copied = 0
    let batch: Document[] = []
    for await (const doc of source.find()) {
      batch.push(doc)
      if (batch.length >= 500) {
        await target.insertMany(batch)
        copied += batch.length
        batch = []
      }
    }
    if (batch.length) {
      await target.insertMany(batch)
      copied += batch.length
    }
    return copied
  })

  // ---- indexes ---------------------------------------------------------------------------
  handle('server:indexes', async (id: string, db: string, coll: string): Promise<IndexInfo[]> => {
    const c = clients.get(id).client.db(db).collection(coll)
    const [indexes, stats] = await Promise.all([
      c.indexes(),
      c.db.command({ collStats: coll }).catch(() => ({}) as Document)
    ])
    const sizes = (stats.indexSizes ?? {}) as Record<string, number>
    return indexes.map((i) => ({
      name: String(i.name),
      key: i.key as Record<string, unknown>,
      unique: i.unique as boolean | undefined,
      sparse: i.sparse as boolean | undefined,
      background: i.background as boolean | undefined,
      expireAfterSeconds: i.expireAfterSeconds as number | undefined,
      partialFilterExpression: i.partialFilterExpression as Record<string, unknown> | undefined,
      size: sizes[String(i.name)],
      raw: JSON.parse(ej(i))
    }))
  })
  handle('server:createIndex', async (id: string, db: string, coll: string, req: CreateIndexRequest) => {
    const opts: Document = {}
    if (req.name) opts.name = req.name
    if (req.unique) opts.unique = true
    if (req.sparse) opts.sparse = true
    if (req.expireAfterSeconds !== undefined && req.expireAfterSeconds !== null) opts.expireAfterSeconds = req.expireAfterSeconds
    if (req.partialFilterEjson) opts.partialFilterExpression = parse(req.partialFilterEjson)
    return clients.get(id).client.db(db).collection(coll).createIndex(parse(req.keysEjson), opts)
  })
  handle('server:dropIndex', async (id: string, db: string, coll: string, name: string) => {
    await clients.get(id).client.db(db).collection(coll).dropIndex(name)
  })

  // ---- users -----------------------------------------------------------------------------
  handle('server:users', async (id: string, db: string): Promise<UserInfo[]> => {
    const r = await clients.get(id).client.db(db).command({ usersInfo: 1 })
    return ((r.users as Document[]) ?? []).map((u) => ({
      _id: String(u._id),
      user: String(u.user),
      db: String(u.db),
      roles: ((u.roles as Document[]) ?? []).map((r) => ({ role: String(r.role), db: String(r.db) }))
    }))
  })
  handle('server:createUser', async (id: string, db: string, req: CreateUserRequest) => {
    await clients.get(id).client.db(db).command({ createUser: req.user, pwd: req.pwd, roles: req.roles })
  })
  handle('server:dropUser', async (id: string, db: string, user: string) => {
    await clients.get(id).client.db(db).command({ dropUser: user })
  })
  handle('server:functions', async (id: string, db: string) => {
    const docs = await clients.get(id).client.db(db).collection('system.js').find().toArray()
    return docs.map((d) => ({ _id: String(d._id), value: String((d.value as { code?: string })?.code ?? d.value) }))
  })

  // ---- queries ---------------------------------------------------------------------------
  handle('query:execute', (id: string, db: string, script: string, opts: QueryOptions) =>
    runScript(clients.get(id).client, db, script, opts)
  )
  handle('query:evalDocument', (text: string) => ej(evalDocument(text)))
  handle('query:insertDocument', async (id: string, db: string, coll: string, docEjson: string) => {
    const r = await clients.get(id).client.db(db).collection(coll).insertOne(parse(docEjson))
    return ej(r.insertedId)
  })
  handle('query:replaceDocument', async (id: string, db: string, coll: string, docEjson: string) => {
    const doc = parse(docEjson)
    if (doc._id === undefined) throw new Error('Document has no _id')
    const r = await clients.get(id).client.db(db).collection(coll).replaceOne({ _id: doc._id }, doc)
    if (r.matchedCount === 0) throw new Error('No document matched the _id')
  })
  handle('query:deleteDocument', async (id: string, db: string, coll: string, idEjson: string) => {
    const _id = EJSON.parse(idEjson, { relaxed: false })
    const r = await clients.get(id).client.db(db).collection(coll).deleteOne({ _id: _id as never })
    if (r.deletedCount === 0) throw new Error('No document matched the _id')
  })

  // ---- settings --------------------------------------------------------------------------
  handle('settings:get', () => store.getSettings())
  handle('settings:set', (patch: Document) => store.setSettings(patch))

  // ---- updates ---------------------------------------------------------------------------
  handle('updates:status', () => updater.getUpdateStatus())
  handle('updates:check', () => updater.checkForUpdates())
  handle('updates:download', () => updater.downloadUpdate())
  handle('updates:install', () => updater.installUpdate())
  handle('updates:openReleases', () => updater.openReleasesPage())

  // ---- ui --------------------------------------------------------------------------------
  handle('ui:contextMenu', (items: ContextMenuItem[]) => {
    const win = getWindow()
    if (!win) return null
    return new Promise<string | null>((resolve) => {
      let picked: string | null = null
      const toTemplate = (list: ContextMenuItem[]): MenuItemConstructorOptions[] =>
        list.map((i) =>
          i.type === 'separator'
            ? { type: 'separator' }
            : {
                label: i.label,
                enabled: i.enabled !== false,
                submenu: i.submenu ? toTemplate(i.submenu) : undefined,
                click: i.submenu ? undefined : () => void (picked = i.id ?? null)
              }
        )
      Menu.buildFromTemplate(toTemplate(items)).popup({ window: win, callback: () => resolve(picked) })
    })
  })
  handle('ui:openFile', async (filters?: { name: string; extensions: string[] }[]) => {
    const win = getWindow()
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'showHiddenFiles'], filters })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('ui:readFile', (path: string) => fs.readFile(path, 'utf8'))
  handle('ui:saveFile', async (defaultName: string, content: string) => {
    const win = getWindow()
    const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName })
    if (r.canceled || !r.filePath) return false
    await fs.writeFile(r.filePath, content, 'utf8')
    return true
  })
  handle('ui:confirm', async (title: string, message: string, detail?: string) => {
    const win = getWindow()
    const r = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Cancel', title],
      defaultId: 1,
      cancelId: 0,
      message,
      detail
    })
    return r.response === 1
  })
}
