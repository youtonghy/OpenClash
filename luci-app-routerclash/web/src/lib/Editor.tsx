import { useEffect, useRef } from 'react'
import { t } from './i18n'

type CodeMirror = {
  baseExtensions: () => unknown
  themeExtension: (dark: boolean) => unknown
  yaml: () => unknown
  yamlLinter: () => unknown
  lintGutter: () => unknown
  indentUnit: { of: (value: string) => unknown }
  EditorState: { create: (config: { doc: string; extensions: unknown[] }) => unknown }
  EditorView: { new (config: { state: unknown; parent: HTMLElement }): EditorInstance; updateListener: { of: (fn: (update: { docChanged: boolean; state: { doc: { toString: () => string } } }) => void) => unknown } }
}
type EditorInstance = { destroy: () => void; dispatch: (tr: unknown) => void; state: { doc: { length: number; toString: () => string } } }

declare global {
  interface Window {
    CM6?: CodeMirror
  }
}

let loading: Promise<void> | undefined
function loadEditor() {
  if (window.CM6) return Promise.resolve()
  loading ??= new Promise<void>((resolve, reject) => {
    const base = '/luci-static/resources/routerclash'
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${base}/css/rc-cm6.css`
    document.head.append(css)
    const script = document.createElement('script')
    script.src = `${base}/js/cm6.min.js`
    script.onload = () => resolve()
    script.onerror = () => {
      loading = undefined
      reject(new Error('editor failed to load'))
    }
    document.head.append(script)
  })
  return loading
}

/** YAML editor backed by the CodeMirror bundle the package already ships. Falls back to a textarea. */
export function Editor({ value, onChange, yaml = true, label }: { value: string; onChange: (value: string) => void; yaml?: boolean; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorInstance | null>(null)
  const change = useRef(onChange)
  useEffect(() => {
    change.current = onChange
  })

  useEffect(() => {
    let cancelled = false
    const node = host.current
    void loadEditor().then(() => {
      const CM6 = window.CM6
      if (cancelled || !CM6 || !node) return
      const dark = document.documentElement.dataset.theme === 'dark'
      const extensions = [
        CM6.baseExtensions(),
        CM6.themeExtension(dark),
        CM6.indentUnit.of('  '),
        CM6.EditorView.updateListener.of(update => {
          if (update.docChanged) change.current(update.state.doc.toString())
        }),
      ]
      if (yaml) extensions.push(CM6.yaml(), CM6.yamlLinter(), CM6.lintGutter())
      view.current = new CM6.EditorView({ state: CM6.EditorState.create({ doc: value, extensions }), parent: node })
    }).catch(() => {
      if (node) node.textContent = t('编辑器加载失败，请刷新页面重试', 'The editor could not load. Reload the page to try again.')
    })
    return () => {
      cancelled = true
      view.current?.destroy()
      view.current = null
    }
    // the editor is rebuilt only when the document identity (key) or language changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yaml])

  return <div ref={host} aria-label={label} style={{ minHeight: 320 }} />
}
