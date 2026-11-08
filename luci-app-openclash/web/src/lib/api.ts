declare global {
  interface Window {
    __OC__?: { base: string; token: string; version: string }
  }
}

export const app = window.__OC__ ?? { base: '/cgi-bin/luci/admin/services/openclash', token: '', version: 'dev' }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.status === 403 || response.redirected) throw new ApiError(403, 'session expired')
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      message = (await response.json()).error ?? message
    } catch {
      // the body was not JSON, keep the status text
    }
    throw new ApiError(response.status, message)
  }
  const type = response.headers.get('content-type') ?? ''
  return (type.includes('json') ? await response.json() : await response.text()) as T
}

export function apiGet<T>(route: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams(params).toString()
  return fetch(`${app.base}/${route}${query ? `?${query}` : ''}`, { credentials: 'same-origin' }).then(unwrap<T>)
}

export function apiPost<T>(route: string, params: Record<string, string> = {}): Promise<T> {
  const body = new URLSearchParams({ token: app.token, ...params })
  return fetch(`${app.base}/${route}`, { method: 'POST', credentials: 'same-origin', body }).then(unwrap<T>)
}

/** Upload handlers read the token from the query string, before the body is parsed. */
export function apiUpload<T>(route: string, form: FormData, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ token: app.token, ...params }).toString()
  return fetch(`${app.base}/${route}?${query}`, { method: 'POST', credentials: 'same-origin', body: form }).then(unwrap<T>)
}

export const service = (action: 'start' | 'stop' | 'restart') => apiPost('action', { action })

export type Status = {
  clash: boolean
  daip?: string
  dase?: string
  cn_port?: string
  run_mode?: string
  rule_mode?: string
  mixed_port?: string
  metacubexd?: boolean
  zashboard?: boolean
  db_foward_domain?: string
  db_foward_port?: string
  db_forward_ssl?: string
  dashboard_custom_url?: string
}

export type ConfigFile = { name: string; path: string; size: number; mtime: number }

export const isRunning = (status?: Status) => !!status?.clash && !!status?.daip

export function bytes(value: number, digits = 1): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  let size = value
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(index === 0 ? 0 : digits)} ${units[index]}`
}
