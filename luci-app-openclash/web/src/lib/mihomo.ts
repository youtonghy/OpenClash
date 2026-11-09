import { useEffect, useRef, useState } from 'react'
import type { Status } from './api'

export type Connection = {
  id: string
  upload: number
  download: number
  chains: string[]
  rule: string
  rulePayload: string
  start: string
  metadata: {
    host: string
    destinationIP: string
    sourceIP: string
    network: string
    destinationPort: string
    sourcePort?: string
    type?: string
    process?: string
    processPath?: string
    sniffHost?: string
    remoteDestination?: string
  }
}

export type ProxyHistory = { time?: string; delay: number }[]
export type ProxyNode = {
  name: string
  type: string
  now?: string
  all?: string[]
  hidden?: boolean
  fixed?: string
  testUrl?: string
  history?: ProxyHistory
  extra?: Record<string, { history?: ProxyHistory }>
}
export type ProxyMap = Record<string, ProxyNode>

const GLOBAL = 'GLOBAL'

/** Proxy groups in config order. GLOBAL only matters in global mode, so it is listed first and only then. */
export function proxyGroups(proxies: ProxyMap, showGlobal = false) {
  const order = proxies[GLOBAL]?.all ?? []
  const rank = (name: string) => {
    const index = order.indexOf(name)
    return index === -1 ? order.length : index
  }
  return Object.values(proxies)
    .filter(item => item.all?.length && !item.hidden && (item.name !== GLOBAL || showGlobal))
    .sort((a, b) => (a.name === GLOBAL ? -1 : b.name === GLOBAL ? 1 : rank(a.name) - rank(b.name)))
}

export type Snapshot = { downloadTotal: number; uploadTotal: number; connections: Connection[]; memory?: number }

/** nginx installs expose the controller under /oc-api; plain uhttpd installs reach it on its port. */
let probe: Promise<boolean> | undefined
function hasSameOriginProxy(status: Status) {
  probe ??= fetch('/oc-api/version', { headers: { Authorization: `Bearer ${status.dase ?? ''}` } })
    .then(response => response.ok && (response.headers.get('content-type') ?? '').includes('json'))
    .catch(() => false)
  return probe
}

async function controllerBase(status: Status) {
  if (await hasSameOriginProxy(status)) {
    return { http: `${location.origin}/oc-api`, ws: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/oc-api` }
  }
  const host = `${location.hostname}:${status.cn_port ?? '9090'}`
  return { http: `http://${host}`, ws: `ws://${host}` }
}

export async function mihomoFetch<T>(status: Status, path: string, init: RequestInit = {}): Promise<T> {
  const base = await controllerBase(status)
  const response = await fetch(`${base.http}${path}`, { ...init, headers: { Authorization: `Bearer ${status.dase ?? ''}`, ...init.headers } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

/** Subscribes to a controller stream while the core runs. Stops when the tab is hidden. */
export function useMihomoStream<T>(status: Status | undefined, path: string, enabled: boolean, onMessage: (data: T) => void) {
  const handler = useRef(onMessage)
  useEffect(() => {
    handler.current = onMessage
  })
  const secret = status?.dase
  const port = status?.cn_port
  useEffect(() => {
    if (!enabled || !status) return
    let closed = false
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = async () => {
      if (closed || document.hidden) return
      const base = await controllerBase(status)
      if (closed) return
      const separator = path.includes('?') ? '&' : '?'
      socket = new WebSocket(`${base.ws}${path}${separator}token=${encodeURIComponent(secret ?? '')}`)
      socket.onmessage = event => handler.current(JSON.parse(event.data) as T)
      socket.onclose = () => {
        if (!closed) timer = setTimeout(connect, 3000)
      }
    }
    const onVisibility = () => {
      if (document.hidden) socket?.close()
      else if (!socket || socket.readyState === WebSocket.CLOSED) void connect()
    }

    void connect()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      closed = true
      clearTimeout(timer)
      socket?.close()
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // status is read for its secret and port, which are listed separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, path, secret, port])
}

/** Calls fn immediately and on an interval, pausing while the tab is hidden. */
export function usePolling(fn: () => void, intervalMs: number, enabled = true) {
  const callback = useRef(fn)
  useEffect(() => {
    callback.current = fn
  })
  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      if (!document.hidden) callback.current()
    }
    tick()
    const timer = setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [intervalMs, enabled])
}

export function useTick(ms: number) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setValue(v => v + 1), ms)
    return () => clearInterval(timer)
  }, [ms])
  return value
}
