import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { BarChart3, FileCode2, Files as FilesIcon, Gauge, Layers, ScrollText, Settings as SettingsIcon, Shuffle, RefreshCw, ExternalLink } from 'lucide-react'
import { apiGet, app, isRunning, type Status } from '@/lib/api'
import { t } from '@/lib/i18n'
import { usePolling } from '@/lib/mihomo'
import { Overview } from '@/pages/Overview'
import styles from './App.module.css'

const Stats = lazy(() => import('@/pages/Stats').then(m => ({ default: m.Stats })))
const Config = lazy(() => import('@/pages/Config').then(m => ({ default: m.Config })))
const Providers = lazy(() => import('@/pages/Providers').then(m => ({ default: m.Providers })))
const Overwrite = lazy(() => import('@/pages/Overwrite').then(m => ({ default: m.Overwrite })))
const Files = lazy(() => import('@/pages/Files').then(m => ({ default: m.Files })))
const Settings = lazy(() => import('@/pages/Settings').then(m => ({ default: m.Settings })))
const Update = lazy(() => import('@/pages/Update').then(m => ({ default: m.Update })))
const Logs = lazy(() => import('@/pages/Logs').then(m => ({ default: m.Logs })))

const nav = [
  { id: 'overview', label: t('概览', 'Overview'), icon: Gauge },
  { id: 'stats', label: t('统计', 'Statistics'), icon: BarChart3 },
  { id: 'config', label: t('配置', 'Config'), icon: FileCode2 },
  { id: 'providers', label: t('规则集', 'Providers'), icon: Layers },
  { id: 'overwrite', label: t('覆写', 'Overwrite'), icon: Shuffle },
  { id: 'files', label: t('自定义', 'Custom'), icon: FilesIcon },
  { id: 'settings', label: t('设置', 'Settings'), icon: SettingsIcon },
  { id: 'update', label: t('更新', 'Update'), icon: RefreshCw },
  { id: 'logs', label: t('日志', 'Logs'), icon: ScrollText },
]

const currentPage = () => {
  const id = location.hash.replace(/^#\/?/, '')
  return nav.some(item => item.id === id) ? id : 'overview'
}

function dashboardUrl(status: Status) {
  if (status.dashboard_custom_url && status.dashboard_custom_url !== '0') return status.dashboard_custom_url
  const port = status.cn_port ?? '9090'
  const name = status.metacubexd ? 'metacubexd' : 'zashboard'
  const host = location.hostname
  const query = new URLSearchParams({ hostname: host, port, secret: status.dase ?? '' })
  return `${location.protocol}//${host}:${port}/ui/${name}/#/setup?${query}`
}

export default function App() {
  const [page, setPage] = useState(currentPage)
  const [status, setStatus] = useState<Status>()
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    const onHash = () => setPage(currentPage())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  const refresh = useCallback(() => {
    apiGet<Status>('status').then(setStatus).catch(() => setExpired(true))
  }, [])
  usePolling(refresh, 15000)

  if (expired) {
    return <main className={styles.expired}><p>{t('登录已过期', 'Your session has expired')}</p><a href={app.base}>{t('重新登录', 'Sign in again')}</a></main>
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <a className={styles.brand} href="#/overview">OpenClash</a>
        <nav className={styles.nav} aria-label={t('主导航', 'Main')}>
          {nav.map(item => (
            <a key={item.id} href={`#/${item.id}`} className={styles.link} aria-current={page === item.id ? 'page' : undefined}>
              <item.icon size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          ))}
          {isRunning(status) && status && (
            <a className={styles.link} href={dashboardUrl(status)} target="_blank" rel="noreferrer">
              <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>{t('Clash 面板', 'Dashboard')}</span>
            </a>
          )}
        </nav>
        <a className={styles.back} href="/cgi-bin/luci/">{t('返回路由器管理', 'Back to router admin')}</a>
      </aside>
      <div className={styles.content}>
        <Suspense fallback={null}>
        {page === 'overview' && <Overview status={status} refresh={refresh} />}
        {page === 'stats' && <Stats status={status} />}
        {page === 'config' && <Config />}
        {page === 'providers' && <Providers status={status} />}
        {page === 'overwrite' && <Overwrite />}
        {page === 'files' && <Files />}
        {page === 'settings' && <Settings />}
        {page === 'update' && <Update />}
        {page === 'logs' && <Logs />}
        </Suspense>
      </div>
    </div>
  )
}
