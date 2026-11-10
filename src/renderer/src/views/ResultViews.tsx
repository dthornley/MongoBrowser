import { useEffect, useMemo, useState } from 'react'
import { Document } from 'bson'
import { bsonTypeName, formatInline, formatScalar, formatShell, isExpandable } from '@shared/shellFormat'

export interface DocActions {
  edit(doc: Document, index: number): void
  view(doc: Document, index: number): void
  remove(doc: Document, index: number): void
  insert(): void
  copyText(text: string): void
  /** whether edit/remove are possible (needs a namespace) */
  editable: boolean
}

interface ViewProps {
  docs: Document[]
  /** display offset so numbering continues across pages */
  offset: number
  actions: DocActions
  autoExpandFirst: boolean
}

function valueClass(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return 'string'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number' || typeof v === 'bigint') return 'number'
  if (Array.isArray(v)) return 'container'
  if (typeof v === 'object') {
    const t = (v as { _bsontype?: string })._bsontype
    if (!t) return 'container'
    if (t === 'Long' || t === 'Int32' || t === 'Double' || t === 'Decimal128') return 'number'
  }
  return ''
}

// ---------------------------------------------------------------------------------------------
// Tree view
// ---------------------------------------------------------------------------------------------
interface Row {
  path: string
  depth: number
  keyLabel: string
  value: unknown
  docIndex: number
  isRoot: boolean
  expandable: boolean
}

function childEntries(v: unknown): [string, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [String(i), x])
  if (v && typeof v === 'object') return Object.entries(v as Document)
  return []
}

export function TreeView({ docs, offset, actions, autoExpandFirst }: ViewProps): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    setExpanded(autoExpandFirst && docs.length > 0 ? new Set(['0']) : new Set())
    setSelected(null)
  }, [docs, autoExpandFirst])

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (v: unknown, path: string, depth: number, keyLabel: string, docIndex: number, isRoot: boolean): void => {
      const expandable = isExpandable(v)
      out.push({ path, depth, keyLabel, value: v, docIndex, isRoot, expandable })
      if (expandable && expanded.has(path)) {
        for (const [k, cv] of childEntries(v)) walk(cv, `${path}.${k}`, depth + 1, k, docIndex, false)
      }
    }
    docs.forEach((d, i) => {
      const id = d && typeof d === 'object' && '_id' in d ? formatScalar(d._id) : ''
      walk(d, String(i), 0, `(${offset + i + 1}) ${id}`, i, true)
    })
    return out
  }, [docs, expanded, offset])

  const toggle = (r: Row): void => {
    if (!r.expandable) return
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(r.path)) n.delete(r.path)
      else n.add(r.path)
      return n
    })
  }

  const expandAll = (r: Row, on: boolean): void => {
    setExpanded((s) => {
      const n = new Set(s)
      const walk = (v: unknown, path: string): void => {
        if (!isExpandable(v)) return
        if (on) n.add(path)
        else n.delete(path)
        for (const [k, cv] of childEntries(v)) walk(cv, `${path}.${k}`)
      }
      walk(r.value, r.path)
      return n
    })
  }

  const contextMenu = async (r: Row, e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    setSelected(r.path)
    const doc = docs[r.docIndex]
    const items = [
      { id: 'expandAll', label: 'Expand Recursively', enabled: r.expandable },
      { id: 'collapseAll', label: 'Collapse Recursively', enabled: r.expandable },
      { type: 'separator' as const },
      { id: 'edit', label: 'Edit Document…', enabled: actions.editable },
      { id: 'view', label: 'View Document' },
      { id: 'insert', label: 'Insert Document…', enabled: actions.editable },
      { type: 'separator' as const },
      { id: 'copyValue', label: r.isRoot ? 'Copy Document' : 'Copy Value' },
      { id: 'copyKey', label: 'Copy Key', enabled: !r.isRoot },
      { id: 'copyPath', label: 'Copy Path', enabled: !r.isRoot },
      { type: 'separator' as const },
      { id: 'delete', label: 'Delete Document…', enabled: actions.editable }
    ]
    const picked = await window.api.ui.contextMenu(items)
    switch (picked) {
      case 'expandAll':
        expandAll(r, true)
        break
      case 'collapseAll':
        expandAll(r, false)
        break
      case 'edit':
        actions.edit(doc, r.docIndex)
        break
      case 'view':
        actions.view(doc, r.docIndex)
        break
      case 'insert':
        actions.insert()
        break
      case 'copyValue':
        actions.copyText(formatShell(r.value))
        break
      case 'copyKey':
        actions.copyText(r.keyLabel)
        break
      case 'copyPath':
        actions.copyText(r.path.split('.').slice(1).join('.'))
        break
      case 'delete':
        actions.remove(doc, r.docIndex)
        break
    }
  }

  return (
    <table className="doc-tree">
      <colgroup>
        <col style={{ width: '45%' }} />
        <col />
        <col style={{ width: 110 }} />
      </colgroup>
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isOpen = expanded.has(r.path)
          const summary = r.expandable
            ? Array.isArray(r.value)
              ? `[ ${r.value.length} elements ]`
              : `{ ${Object.keys(r.value as Document).length} fields }`
            : formatScalar(r.value)
          return (
            <tr
              key={r.path}
              className={selected === r.path ? 'selected' : ''}
              onClick={() => setSelected(r.path)}
              onDoubleClick={() => (r.expandable ? toggle(r) : actions.editable && actions.edit(docs[r.docIndex], r.docIndex))}
              onContextMenu={(e) => void contextMenu(r, e)}
            >
              <td style={{ paddingLeft: 6 + r.depth * 18 }}>
                <span className="k">
                  <span className="twisty" onClick={(e) => (e.stopPropagation(), toggle(r))}>
                    {r.expandable ? (isOpen ? '▾' : '▸') : ''}
                  </span>
                  <span className={`key${r.isRoot ? ' root' : ''}`}>{r.keyLabel}</span>
                </span>
              </td>
              <td className={`v ${valueClass(r.value)}`} title={r.expandable ? formatInline(r.value, 500) : summary}>
                {summary}
              </td>
              <td className="t">{bsonTypeName(r.value)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------------------------
export function TableView({ docs, offset, actions }: ViewProps): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null)
  useEffect(() => setSelected(null), [docs])

  const columns = useMemo(() => {
    const cols: string[] = []
    const seen = new Set<string>()
    for (const d of docs) {
      if (!d || typeof d !== 'object') continue
      for (const k of Object.keys(d)) {
        if (!seen.has(k)) {
          seen.add(k)
          cols.push(k)
        }
      }
    }
    // keep _id first like Robo3T
    const i = cols.indexOf('_id')
    if (i > 0) {
      cols.splice(i, 1)
      cols.unshift('_id')
    }
    return cols
  }, [docs])

  const contextMenu = async (idx: number, e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    setSelected(idx)
    const picked = await window.api.ui.contextMenu([
      { id: 'edit', label: 'Edit Document…', enabled: actions.editable },
      { id: 'view', label: 'View Document' },
      { id: 'insert', label: 'Insert Document…', enabled: actions.editable },
      { type: 'separator' },
      { id: 'copy', label: 'Copy Document' },
      { type: 'separator' },
      { id: 'delete', label: 'Delete Document…', enabled: actions.editable }
    ])
    const doc = docs[idx]
    if (picked === 'edit') actions.edit(doc, idx)
    else if (picked === 'view') actions.view(doc, idx)
    else if (picked === 'insert') actions.insert()
    else if (picked === 'copy') actions.copyText(formatShell(doc))
    else if (picked === 'delete') actions.remove(doc, idx)
  }

  return (
    <table className="doc-table">
      <thead>
        <tr>
          <th>#</th>
          {columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {docs.map((d, i) => (
          <tr
            key={i}
            className={selected === i ? 'selected' : ''}
            onClick={() => setSelected(i)}
            onDoubleClick={() => (actions.editable ? actions.edit(d, i) : actions.view(d, i))}
            onContextMenu={(e) => void contextMenu(i, e)}
          >
            <td className="idx">{offset + i + 1}</td>
            {columns.map((c) => {
              const has = d && typeof d === 'object' && c in d
              const v = has ? (d as Document)[c] : undefined
              const text = has ? formatInline(v, 200) : ''
              return (
                <td key={c} className={has ? valueClass(v) : 'missing'} title={has ? `${bsonTypeName(v)}: ${text}` : 'missing'}>
                  {text}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------------------------
// Text view
// ---------------------------------------------------------------------------------------------
export function TextView({ docs, offset, actions }: ViewProps): JSX.Element {
  const text = useMemo(() => docs.map((d) => formatShell(d)), [docs])
  const contextMenu = async (idx: number, e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    if (window.getSelection()?.toString()) {
      const picked = await window.api.ui.contextMenu([{ id: 'copySel', label: 'Copy' }])
      if (picked === 'copySel') actions.copyText(window.getSelection()!.toString())
      return
    }
    const picked = await window.api.ui.contextMenu([
      { id: 'edit', label: 'Edit Document…', enabled: actions.editable },
      { id: 'view', label: 'View Document' },
      { id: 'insert', label: 'Insert Document…', enabled: actions.editable },
      { type: 'separator' },
      { id: 'copy', label: 'Copy Document' },
      { id: 'copyAll', label: 'Copy All' },
      { type: 'separator' },
      { id: 'delete', label: 'Delete Document…', enabled: actions.editable }
    ])
    const doc = docs[idx]
    if (picked === 'edit') actions.edit(doc, idx)
    else if (picked === 'view') actions.view(doc, idx)
    else if (picked === 'insert') actions.insert()
    else if (picked === 'copy') actions.copyText(text[idx])
    else if (picked === 'copyAll') actions.copyText(text.join('\n'))
    else if (picked === 'delete') actions.remove(doc, idx)
  }
  return (
    <pre className="text-view">
      {docs.map((d, i) => (
        <span key={i} onContextMenu={(e) => void contextMenu(i, e)} onDoubleClick={() => actions.editable && actions.edit(d, i)}>
          <span className="doc-sep">{`/* ${offset + i + 1} */`}</span>
          {text[i]}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

/** Text rendering for non-document results (numbers, strings, command responses). */
export function ValueView({ value }: { value: unknown }): JSX.Element {
  return <pre className="text-view">{formatShell(value)}</pre>
}
