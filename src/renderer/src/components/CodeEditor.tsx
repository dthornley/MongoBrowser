import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, highlightSpecialChars } from '@codemirror/view'
import { EditorState, Compartment, Prec } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle, foldGutter } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap, autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'

interface Props {
  value: string
  onChange?: (v: string) => void
  /** Cmd+Enter / F5 */
  onRun?: () => void
  readOnly?: boolean
  autoFocus?: boolean
  completions?: () => string[]
  className?: string
}

const SHELL_WORDS = [
  'find',
  'findOne',
  'aggregate',
  'count',
  'countDocuments',
  'estimatedDocumentCount',
  'distinct',
  'insert',
  'insertOne',
  'insertMany',
  'update',
  'updateOne',
  'updateMany',
  'replaceOne',
  'remove',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findAndModify',
  'createIndex',
  'getIndexes',
  'dropIndex',
  'dropIndexes',
  'drop',
  'stats',
  'renameCollection',
  'sort',
  'limit',
  'skip',
  'projection',
  'explain',
  'toArray',
  'forEach',
  'pretty',
  'getCollection',
  'getCollectionNames',
  'getSiblingDB',
  'runCommand',
  'adminCommand',
  'serverStatus',
  'getUsers',
  'createUser',
  'dropUser',
  'dropDatabase',
  'createCollection',
  'ObjectId',
  'ISODate',
  'NumberLong',
  'NumberInt',
  'NumberDecimal',
  'Timestamp',
  'BinData',
  'UUID',
  'printjson',
  'print',
  '$match',
  '$group',
  '$sort',
  '$project',
  '$limit',
  '$skip',
  '$unwind',
  '$lookup',
  '$addFields',
  '$set',
  '$unset',
  '$inc',
  '$push',
  '$pull',
  '$in',
  '$nin',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$ne',
  '$exists',
  '$regex',
  '$or',
  '$and',
  '$not',
  '$elemMatch',
  '$size',
  '$type',
  '$sum',
  '$avg',
  '$min',
  '$max',
  '$first',
  '$last',
  '$count'
]

export default function CodeEditor({ value, onChange, onRun, readOnly, autoFocus, completions, className }: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onRunRef = useRef(onRun)
  const completionsRef = useRef(completions)
  onChangeRef.current = onChange
  onRunRef.current = onRun
  completionsRef.current = completions
  const readOnlyCompartment = useRef(new Compartment())

  useEffect(() => {
    if (!host.current) return
    const complete = (ctx: CompletionContext): CompletionResult | null => {
      const word = ctx.matchBefore(/[\w$]+/)
      if (!word || (word.from === word.to && !ctx.explicit)) return null
      const extra = completionsRef.current?.() ?? []
      const seen = new Set<string>()
      const options = [...extra.map((label) => ({ label, type: 'variable' })), ...SHELL_WORDS.map((label) => ({ label, type: 'function' }))].filter(
        (o) => (seen.has(o.label) ? false : (seen.add(o.label), true))
      )
      return { from: word.from, options, validFor: /^[\w$]*$/ }
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        Prec.highest(
          keymap.of([
            { key: 'Mod-Enter', run: () => (onRunRef.current?.(), true) },
            { key: 'F5', run: () => (onRunRef.current?.(), true) }
          ])
        ),
        lineNumbers(),
        foldGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [complete], activateOnTyping: true }),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        javascript(),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
        readOnlyCompartment.current.of(EditorState.readOnly.of(!!readOnly)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
        }),
        EditorView.theme({ '&': { height: '100%' } })
      ]
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    if (autoFocus) v.focus()
    return () => {
      v.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep external value changes (e.g. loading a script) in sync without clobbering the cursor on our own edits
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current !== value) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(!!readOnly)) })
  }, [readOnly])

  return <div ref={host} className={className} style={{ height: '100%' }} />
}
