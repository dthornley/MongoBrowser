import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenuItem, IndexInfo } from '@shared/types'
import { actions, collectionRef, useAppState } from '../store'
import { formatInline } from '@shared/shellFormat'

type NodeKind = 'connection' | 'db' | 'collections' | 'collection' | 'index' | 'users' | 'user' | 'functions' | 'function' | 'system' | 'info'

export interface TreeNode {
  key: string
  kind: NodeKind
  label: string
  connectionId: string
  db?: string
  collection?: string
  name?: string
  count?: number
  leaf?: boolean
  muted?: boolean
  data?: unknown
}

interface LoadedChildren {
  nodes: TreeNode[]
  error?: string
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function loadChildren(node: TreeNode): Promise<TreeNode[]> {
  const api = window.api.server
  const cid = node.connectionId
  switch (node.kind) {
    case 'connection': {
      const dbs = await api.databases(cid)
      return dbs.map((d) => ({
        key: `db:${cid}/${d.name}`,
        kind: 'db',
        label: d.name,
        connectionId: cid,
        db: d.name,
        data: d
      }))
    }
    case 'db': {
      const db = node.db!
      const colls = await api.collections(cid, db)
      const user = colls.filter((c) => !c.system)
      const system = colls.filter((c) => c.system)
      const nodes: TreeNode[] = [
        { key: `collections:${cid}/${db}`, kind: 'collections', label: 'Collections', connectionId: cid, db, count: user.length, data: user },
        { key: `functions:${cid}/${db}`, kind: 'functions', label: 'Functions', connectionId: cid, db },
        { key: `users:${cid}/${db}`, kind: 'users', label: 'Users', connectionId: cid, db }
      ]
      if (system.length) nodes.splice(1, 0, { key: `system:${cid}/${db}`, kind: 'system', label: 'System', connectionId: cid, db, count: system.length, data: system })
      return nodes
    }
    case 'collections':
    case 'system': {
      const db = node.db!
      const colls = node.data as { name: string; type: string }[] | undefined
      const list = colls ?? (await api.collections(cid, db)).filter((c) => (node.kind === 'system' ? c.system : !c.system))
      return list.map((c) => ({
        key: `collection:${cid}/${db}/${c.name}`,
        kind: 'collection',
        label: c.name,
        connectionId: cid,
        db,
        collection: c.name,
        muted: c.type === 'view',
        data: c
      }))
    }
    case 'collection': {
      const idx = await api.indexes(cid, node.db!, node.collection!)
      return idx.map((i) => ({
        key: `index:${cid}/${node.db}/${node.collection}/${i.name}`,
        kind: 'index',
        label: i.name,
        connectionId: cid,
        db: node.db,
        collection: node.collection,
        name: i.name,
        leaf: true,
        data: i
      }))
    }
    case 'users': {
      const users = await api.users(cid, node.db!)
      return users.map((u) => ({
        key: `user:${cid}/${node.db}/${u.user}`,
        kind: 'user',
        label: u.user,
        connectionId: cid,
        db: node.db,
        name: u.user,
        leaf: true,
        data: u
      }))
    }
    case 'functions': {
      const fns = await api.functions(cid, node.db!)
      return fns.map((f) => ({
        key: `function:${cid}/${node.db}/${f._id}`,
        kind: 'function',
        label: f._id,
        connectionId: cid,
        db: node.db,
        name: f._id,
        leaf: true,
        data: f
      }))
    }
    default:
      return []
  }
}

const ICONS: Record<NodeKind, { glyph: string; cls: string }> = {
  connection: { glyph: '◉', cls: 'conn' },
  db: { glyph: '▣', cls: 'db' },
  collections: { glyph: '▤', cls: 'folder' },
  system: { glyph: '▤', cls: 'folder' },
  collection: { glyph: '☰', cls: 'coll' },
  index: { glyph: '⚲', cls: 'index' },
  users: { glyph: '▤', cls: 'folder' },
  user: { glyph: '☺', cls: 'user' },
  functions: { glyph: '▤', cls: 'folder' },
  function: { glyph: 'ƒ', cls: 'index' },
  info: { glyph: '', cls: '' }
}

export default function Explorer(): JSX.Element {
  const connections = useAppState((s) => s.connections)
  const sessions = useAppState((s) => s.sessions)
  const refreshToken = useAppState((s) => s.refreshToken)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [children, setChildren] = useState<Map<string, LoadedChildren>>(new Map())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const lastRefresh = useRef(0)

  const load = useCallback(async (node: TreeNode) => {
    setLoading((s) => new Set(s).add(node.key))
    try {
      const nodes = await loadChildren(node)
      setChildren((m) => new Map(m).set(node.key, { nodes }))
    } catch (err) {
      setChildren((m) => new Map(m).set(node.key, { nodes: [], error: (err as Error).message }))
    } finally {
      setLoading((s) => {
        const n = new Set(s)
        n.delete(node.key)
        return n
      })
    }
  }, [])

  const rootNodes: TreeNode[] = useMemo(
    () =>
      connections.map((c) => ({
        key: `conn:${c.id}`,
        kind: 'connection' as NodeKind,
        label: c.name,
        connectionId: c.id
      })),
    [connections]
  )

  // Collapse connections that drop out of the "connected" state and forget their cache.
  useEffect(() => {
    setChildren((m) => {
      const n = new Map(m)
      for (const k of n.keys()) {
        const cid = k.split(':')[1]?.split('/')[0]
        if (cid && sessions[cid]?.state !== 'connected') n.delete(k)
      }
      return n
    })
  }, [sessions])

  // targeted refresh requested from elsewhere in the app (after create/drop operations)
  useEffect(() => {
    if (refreshToken.n === lastRefresh.current) return
    lastRefresh.current = refreshToken.n
    const key = refreshToken.key
    setChildren((m) => {
      const n = new Map(m)
      for (const k of n.keys()) if (k === key || k.startsWith(key + '/')) n.delete(k)
      return n
    })
  }, [refreshToken])

  const findNode = useCallback(
    (key: string): TreeNode | undefined => {
      const root = rootNodes.find((n) => n.key === key)
      if (root) return root
      for (const { nodes } of children.values()) {
        const n = nodes.find((x) => x.key === key)
        if (n) return n
      }
      return undefined
    },
    [rootNodes, children]
  )

  // auto-load expanded nodes whose cache is missing
  useEffect(() => {
    for (const key of expanded) {
      if (children.has(key) || loading.has(key)) continue
      const node = findNode(key)
      if (!node) continue
      if (node.kind === 'connection' && sessions[node.connectionId]?.state !== 'connected') continue
      void load(node)
    }
  }, [expanded, children, loading, findNode, load, sessions])

  const toggle = async (node: TreeNode): Promise<void> => {
    if (node.leaf) return
    if (node.kind === 'connection' && sessions[node.connectionId]?.state !== 'connected') {
      try {
        await actions.connect(node.connectionId)
      } catch {
        return
      }
    }
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(node.key)) n.delete(node.key)
      else n.add(node.key)
      return n
    })
  }

  const refresh = (key: string): void => {
    setChildren((m) => {
      const n = new Map(m)
      for (const k of n.keys()) if (k === key || k.startsWith(key + '/')) n.delete(k)
      return n
    })
    setExpanded((s) => new Set(s).add(key))
  }

  const openShell = (node: TreeNode, script = '', run = false, title?: string): void => {
    actions.openTab(node.connectionId, node.db ?? 'test', script, { run, title })
  }

  const doubleClick = (node: TreeNode): void => {
    if (node.kind === 'collection') {
      openShell(node, `${collectionRef(node.collection!)}.find({})`, true, node.collection)
    } else if (node.kind === 'index') {
      const info = node.data as IndexInfo
      openShell(node, `${collectionRef(node.collection!)}.getIndexes()`, true, `${node.collection}: ${info.name}`)
    } else if (node.kind === 'function') {
      openShell(node, `db.system.js.findOne({ _id: ${JSON.stringify(node.name)} })`, true, node.name)
    } else if (node.kind === 'user') {
      openShell(node, `db.getUser(${JSON.stringify(node.name)})`, true, node.name)
    } else {
      void toggle(node)
    }
  }

  const contextMenu = async (node: TreeNode, e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    setSelected(node.key)
    const items = menuFor(node, sessions[node.connectionId]?.state === 'connected')
    const picked = await window.api.ui.contextMenu(items)
    if (picked) await handleMenu(node, picked, { refresh, openShell, toggle })
  }

  const renderNode = (node: TreeNode, depth: number): JSX.Element[] => {
    const isOpen = expanded.has(node.key)
    const session = sessions[node.connectionId]
    const isLoading = loading.has(node.key) || (node.kind === 'connection' && session?.state === 'connecting')
    const kids = children.get(node.key)
    const icon = ICONS[node.kind]
    let status = ''
    if (node.kind === 'connection') {
      if (session?.state === 'connected') status = session.serverInfo?.version ?? ''
      else if (session?.state === 'error') status = 'error'
    } else if (node.kind === 'db') {
      const d = node.data as { sizeOnDisk: number } | undefined
      if (d) status = fmtBytes(d.sizeOnDisk)
    } else if (node.kind === 'index') {
      const info = node.data as IndexInfo
      status = formatInline(info.key, 40)
    }

    const rows: JSX.Element[] = [
      <div
        key={node.key}
        className={`tree-row${selected === node.key ? ' selected' : ''}${session?.state === 'error' && node.kind === 'connection' ? ' error' : ''}${node.muted ? ' muted' : ''}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        title={node.kind === 'connection' && session?.error ? session.error : node.label}
        onClick={() => setSelected(node.key)}
        onDoubleClick={() => doubleClick(node)}
        onContextMenu={(e) => void contextMenu(node, e)}
      >
        <span className="twisty" onClick={(e) => (e.stopPropagation(), void toggle(node))}>
          {node.leaf ? '' : isLoading ? '…' : isOpen ? '▾' : '▸'}
        </span>
        <span className={`icon ${icon.cls}`}>{icon.glyph}</span>
        <span className="label">{node.label}</span>
        {node.count !== undefined && <span className="count">({node.count})</span>}
        {status && <span className="status">{status}</span>}
      </div>
    ]
    if (isOpen) {
      if (kids?.error) {
        rows.push(
          <div key={node.key + '/err'} className="tree-row error" style={{ paddingLeft: 22 + depth * 16 }} title={kids.error}>
            <span className="label">{kids.error}</span>
          </div>
        )
      } else if (kids && kids.nodes.length === 0 && !isLoading) {
        rows.push(
          <div key={node.key + '/empty'} className="tree-row muted" style={{ paddingLeft: 22 + depth * 16 }}>
            <span className="label">(empty)</span>
          </div>
        )
      } else if (kids) {
        for (const k of kids.nodes) rows.push(...renderNode(k, depth + 1))
      }
    }
    return rows
  }

  return (
    <div className="explorer-tree" onContextMenu={(e) => e.preventDefault()}>
      {rootNodes.length === 0 && (
        <div className="result-placeholder">
          No connections yet.
          <br />
          <button className="tbtn" style={{ marginTop: 10 }} onClick={() => actions.openModal('connectionManager')}>
            Connect…
          </button>
        </div>
      )}
      {rootNodes.flatMap((n) => renderNode(n, 0))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Context menus — modelled on Robo3T's explorer menus.
// ---------------------------------------------------------------------------------------------
function menuFor(node: TreeNode, connected: boolean): ContextMenuItem[] {
  const sep: ContextMenuItem = { type: 'separator' }
  switch (node.kind) {
    case 'connection':
      return connected
        ? [
            { id: 'shell', label: 'Open Shell' },
            { id: 'refresh', label: 'Refresh' },
            sep,
            { id: 'createDb', label: 'Create Database…' },
            sep,
            { id: 'serverStatus', label: 'Server Status' },
            { id: 'hostInfo', label: 'Host Info' },
            { id: 'serverLog', label: 'Show Log' },
            { id: 'currentOp', label: 'Current Operations' },
            sep,
            { id: 'editConn', label: 'Edit Connection…' },
            { id: 'disconnect', label: 'Disconnect' }
          ]
        : [
            { id: 'connect', label: 'Connect' },
            { id: 'editConn', label: 'Edit Connection…' },
            { id: 'removeConn', label: 'Remove Connection…' }
          ]
    case 'db':
      return [
        { id: 'shell', label: 'Open Shell' },
        { id: 'refresh', label: 'Refresh' },
        sep,
        { id: 'dbStats', label: 'Database Statistics' },
        { id: 'createColl', label: 'Create Collection…' },
        { id: 'addUser', label: 'Add User…' },
        sep,
        { id: 'dropDb', label: 'Drop Database…' }
      ]
    case 'collections':
    case 'system':
      return [
        { id: 'createColl', label: 'Create Collection…' },
        { id: 'refresh', label: 'Refresh' }
      ]
    case 'collection':
      return [
        { id: 'view', label: 'View Documents' },
        { id: 'shell', label: 'Open Shell' },
        sep,
        { id: 'insert', label: 'Insert Document…' },
        { id: 'update', label: 'Update Documents' },
        { id: 'remove', label: 'Remove Documents' },
        { id: 'removeAll', label: 'Remove All Documents…' },
        sep,
        { id: 'stats', label: 'Statistics' },
        { id: 'count', label: 'Count Documents' },
        { id: 'indexes', label: 'Indexes', type: 'submenu', submenu: [{ id: 'addIndex', label: 'Add Index…' }, { id: 'listIndexes', label: 'View Indexes' }, { id: 'refresh', label: 'Refresh' }] },
        sep,
        { id: 'rename', label: 'Rename Collection…' },
        { id: 'duplicate', label: 'Duplicate Collection…' },
        { id: 'copyTo', label: 'Copy Collection to Database…' },
        { id: 'export', label: 'Export Collection to JSON…' },
        sep,
        { id: 'dropColl', label: 'Drop Collection…' }
      ]
    case 'index':
      return [
        { id: 'listIndexes', label: 'View Indexes' },
        { id: 'explain', label: 'Explain Query Using Index' },
        sep,
        { id: 'dropIndex', label: 'Drop Index…', enabled: node.name !== '_id_' }
      ]
    case 'users':
      return [
        { id: 'addUser', label: 'Add User…' },
        { id: 'refresh', label: 'Refresh' }
      ]
    case 'user':
      return [
        { id: 'viewUser', label: 'View User' },
        { id: 'dropUser', label: 'Drop User…' }
      ]
    case 'functions':
      return [
        { id: 'addFunction', label: 'Add Function…' },
        { id: 'refresh', label: 'Refresh' }
      ]
    case 'function':
      return [
        { id: 'viewFunction', label: 'View Function' },
        { id: 'removeFunction', label: 'Remove Function…' }
      ]
    default:
      return []
  }
}

interface MenuCtx {
  refresh: (key: string) => void
  openShell: (node: TreeNode, script?: string, run?: boolean, title?: string) => void
  toggle: (node: TreeNode) => Promise<void>
}

async function handleMenu(node: TreeNode, id: string, ctx: MenuCtx): Promise<void> {
  const api = window.api
  const cid = node.connectionId
  const db = node.db ?? ''
  const coll = node.collection ?? ''
  const ref = coll ? collectionRef(coll) : ''
  const dbKey = `db:${cid}/${db}`
  const collKey = `collection:${cid}/${db}/${coll}`
  const confirm = (title: string, message: string, detail?: string): Promise<boolean> => api.ui.confirm(title, message, detail)
  const fail = (what: string, err: unknown): void => {
    actions.log(`${what}: ${(err as Error).message}`, 'error')
    actions.openModal('alert', { title: what, message: (err as Error).message })
  }

  try {
    switch (id) {
      case 'connect':
        await ctx.toggle(node)
        return
      case 'disconnect':
        await actions.disconnect(cid)
        return
      case 'editConn':
        actions.openModal('connectionDialog', { connectionId: cid })
        return
      case 'removeConn':
        if (await confirm('Remove', `Remove connection "${node.label}"?`)) {
          await api.connections.remove(cid)
          await actions.loadConnections()
        }
        return
      case 'refresh':
        ctx.refresh(node.kind === 'collection' ? collKey : node.key)
        return
      case 'shell':
        ctx.openShell(node, coll ? `${ref}.find({})` : '', false)
        return
      case 'createDb':
        actions.openModal('input', {
          title: 'Create Database',
          label: 'Database name',
          onSubmit: async (name: string) => {
            await api.server.createDatabase(cid, name)
            ctx.refresh(node.key)
          }
        })
        return
      case 'serverStatus':
        ctx.openShell(node, 'db.serverStatus()', true, 'Server Status')
        return
      case 'hostInfo':
        ctx.openShell(node, 'db.hostInfo()', true, 'Host Info')
        return
      case 'serverLog':
        ctx.openShell(node, "db.adminCommand({ getLog: 'global' })", true, 'Log')
        return
      case 'currentOp':
        ctx.openShell(node, 'db.currentOp()', true, 'Current Op')
        return
      case 'dbStats':
        ctx.openShell(node, 'db.stats()', true, `${db} stats`)
        return
      case 'createColl':
        actions.openModal('createCollection', {
          onSubmit: async (req: { name: string; capped?: boolean; size?: number; max?: number }) => {
            await api.server.createCollection(cid, db, req)
            ctx.refresh(dbKey)
          }
        })
        return
      case 'addUser':
        actions.openModal('createUser', {
          db,
          onSubmit: async (req: { user: string; pwd: string; roles: { role: string; db: string }[] }) => {
            await api.server.createUser(cid, db, req)
            ctx.refresh(`users:${cid}/${db}`)
          }
        })
        return
      case 'dropDb':
        if (await confirm('Drop Database', `Drop database "${db}"?`, 'All collections and documents will be permanently deleted.')) {
          await api.server.dropDatabase(cid, db)
          ctx.refresh(`conn:${cid}`)
        }
        return
      case 'view':
        ctx.openShell(node, `${ref}.find({})`, true, coll)
        return
      case 'insert':
        actions.openModal('document', {
          mode: 'insert',
          connectionId: cid,
          db,
          collection: coll,
          text: '{\n    \n}'
        })
        return
      case 'update':
        ctx.openShell(node, `${ref}.updateMany(\n    { /* query */ },\n    { $set: { /* fields */ } }\n)`, false, coll)
        return
      case 'remove':
        ctx.openShell(node, `${ref}.deleteMany({ /* query */ })`, false, coll)
        return
      case 'removeAll':
        if (await confirm('Remove All', `Remove all documents from "${coll}"?`, 'This cannot be undone.')) {
          ctx.openShell(node, `${ref}.deleteMany({})`, true, coll)
        }
        return
      case 'stats':
        ctx.openShell(node, `${ref}.stats()`, true, `${coll} stats`)
        return
      case 'count':
        ctx.openShell(node, `${ref}.countDocuments({})`, true, `${coll} count`)
        return
      case 'listIndexes':
        ctx.openShell(node, `${ref}.getIndexes()`, true, `${coll} indexes`)
        return
      case 'addIndex':
        actions.openModal('createIndex', {
          collection: coll,
          onSubmit: async (req: { keysEjson: string; name?: string; unique?: boolean; sparse?: boolean; expireAfterSeconds?: number; partialFilterEjson?: string }) => {
            await api.server.createIndex(cid, db, coll, req)
            ctx.refresh(collKey)
          }
        })
        return
      case 'explain': {
        const info = node.data as IndexInfo
        ctx.openShell(node, `${ref}.find({}).hint(${JSON.stringify(info.name)}).explain("executionStats")`, true, `${coll} explain`)
        return
      }
      case 'dropIndex':
        if (await confirm('Drop Index', `Drop index "${node.name}" on "${coll}"?`)) {
          await api.server.dropIndex(cid, db, coll, node.name!)
          ctx.refresh(collKey)
        }
        return
      case 'rename':
        actions.openModal('input', {
          title: 'Rename Collection',
          label: 'New name',
          value: coll,
          onSubmit: async (name: string) => {
            await api.server.renameCollection(cid, db, coll, name)
            ctx.refresh(dbKey)
          }
        })
        return
      case 'duplicate':
        actions.openModal('input', {
          title: 'Duplicate Collection',
          label: 'New collection name',
          value: `${coll}_copy`,
          onSubmit: async (name: string) => {
            const n = await api.server.copyCollection(cid, db, coll, cid, db, name)
            actions.log(`Copied ${n} documents to ${db}.${name}`)
            ctx.refresh(dbKey)
          }
        })
        return
      case 'copyTo':
        actions.openModal('copyCollection', {
          connectionId: cid,
          db,
          collection: coll,
          onDone: (targetDb: string) => ctx.refresh(`db:${cid}/${targetDb}`)
        })
        return
      case 'export':
        actions.openModal('exportCollection', { connectionId: cid, db, collection: coll })
        return
      case 'dropColl':
        if (await confirm('Drop Collection', `Drop collection "${coll}"?`, 'All documents and indexes will be permanently deleted.')) {
          await api.server.dropCollection(cid, db, coll)
          ctx.refresh(dbKey)
        }
        return
      case 'viewUser':
        ctx.openShell(node, `db.getUser(${JSON.stringify(node.name)})`, true, node.name)
        return
      case 'dropUser':
        if (await confirm('Drop User', `Drop user "${node.name}" from "${db}"?`)) {
          await api.server.dropUser(cid, db, node.name!)
          ctx.refresh(`users:${cid}/${db}`)
        }
        return
      case 'addFunction':
        ctx.openShell(node, `db.system.js.insertOne({\n    _id: "myFunction",\n    value: Code("function (x) { return x * 2; }")\n})`, false, 'Add Function')
        return
      case 'viewFunction':
        ctx.openShell(node, `db.system.js.findOne({ _id: ${JSON.stringify(node.name)} })`, true, node.name)
        return
      case 'removeFunction':
        if (await confirm('Remove Function', `Remove function "${node.name}"?`)) {
          ctx.openShell(node, `db.system.js.deleteOne({ _id: ${JSON.stringify(node.name)} })`, true, node.name)
          setTimeout(() => ctx.refresh(`functions:${cid}/${db}`), 500)
        }
        return
    }
  } catch (err) {
    fail(`Operation failed`, err)
  }
}
