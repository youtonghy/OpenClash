import { useCallback, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Gauge } from '@/components/arc/gauge/gauge'
import { SortableDataTable } from '@/components/arc/sortable-data-table/sortable-data-table'
import { bytes, isRunning, type Status } from '@/lib/api'
import { t } from '@/lib/i18n'
import { mihomoFetch, usePolling } from '@/lib/mihomo'
import styles from './layout.module.css'

type RuleProvider = { name: string; behavior: string; format: string; ruleCount: number; updatedAt: string; vehicleType: string }
type Subscription = { Upload: number; Download: number; Total: number; Expire: number }
type ProxyProvider = { name: string; vehicleType: string; proxies?: { history?: unknown[]; alive?: boolean }[]; updatedAt?: string; subscriptionInfo?: Subscription }
type Row = { name: string; info: string; count: number; updated: string; vehicle: string }
type Kind = 'proxies' | 'rules'

const when = (value?: string) => (value && !value.startsWith('0001') ? new Date(value).toLocaleString() : '')
const target = (kind: Kind, name: string) => `/providers/${kind}/${encodeURIComponent(name)}`
const key = (kind: Kind, name: string) => `${kind}/${name}`

function summary(provider: ProxyProvider) {
  const nodes = provider.proxies ?? []
  const tested = nodes.filter(node => node.history?.length).length
  const parts = [t(`${nodes.length} 个节点`, `${nodes.length} nodes`), provider.vehicleType]
  if (tested) parts.push(t(`${nodes.filter(node => node.alive).length} 个可用`, `${nodes.filter(node => node.alive).length} available`))
  if (when(provider.updatedAt)) parts.push(t(`更新于 ${when(provider.updatedAt)}`, `Updated ${when(provider.updatedAt)}`))
  return parts.join(' · ')
}

export function Providers({ status }: { status?: Status }) {
  const running = isRunning(status)
  const [subscriptions, setSubscriptions] = useState<ProxyProvider[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)

  const load = useCallback(() => {
    if (!status) return Promise.resolve()
    return Promise.all([
      mihomoFetch<{ providers: Record<string, RuleProvider> }>(status, '/providers/rules'),
      mihomoFetch<{ providers: Record<string, ProxyProvider> }>(status, '/providers/proxies'),
    ]).then(([rules, proxies]) => {
      setSubscriptions(Object.values(proxies.providers).filter(item => item.vehicleType !== 'Compatible'))
      setRows(Object.values(rules.providers).map(item => ({ name: item.name, info: `${item.behavior} · ${item.format.replace('Rule', '')}`, count: item.ruleCount, updated: when(item.updatedAt), vehicle: item.vehicleType })))
      setError(null)
    }).catch(err => setError((err as Error).message))
  }, [status])
  usePolling(load, 30000, running)

  const update = (kind: Kind, name: string) => {
    if (!status) return
    setUpdating(key(kind, name))
    mihomoFetch(status, target(kind, name), { method: 'PUT' })
      .then(load)
      .catch(err => setError((err as Error).message))
      .finally(() => setUpdating(null))
  }

  const check = (name: string) => {
    if (!status) return
    setChecking(name)
    mihomoFetch(status, `${target('proxies', name)}/healthcheck`)
      .then(load)
      .catch(err => setError((err as Error).message))
      .finally(() => setChecking(null))
  }

  const updatable: [Kind, string][] = [
    ...subscriptions.filter(item => item.vehicleType === 'HTTP').map(item => ['proxies', item.name] as [Kind, string]),
    ...rows.filter(item => item.vehicle === 'HTTP').map(item => ['rules', item.name] as [Kind, string]),
  ]

  /** One at a time, a router should not fetch every provider at once. */
  const updateAll = async () => {
    if (!status) return
    setUpdatingAll(true)
    setError(null)
    const failed: string[] = []
    for (const [kind, name] of updatable) {
      setUpdating(key(kind, name))
      try {
        await mihomoFetch(status, target(kind, name), { method: 'PUT' })
      } catch {
        failed.push(name)
      }
    }
    setUpdating(null)
    setUpdatingAll(false)
    await load()
    if (failed.length) setError(t(`更新失败：${failed.join('、')}`, `Could not update: ${failed.join(', ')}`))
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('订阅与规则集', 'Subscriptions and rule sets')}</h1>
          <p className={styles.sub}>{t('完整配置形式的订阅在', 'Subscriptions that replace the whole config are updated on the ')}<a href="#/config">{t('配置页', 'config page')}</a>{t('更新。', '.')}</p>
        </div>
        {running && updatable.length > 0 && <div className={styles.tools}><Button loading={updatingAll} onClick={() => void updateAll()}>{t('全部更新', 'Update all')}</Button></div>}
      </header>
      {error && <Alert tone="danger" title={t('读取或更新失败', 'Could not load or update')}>{error}</Alert>}
      {!running
        ? <section className={styles.card}><EmptyState title={t('内核未运行', 'Core is stopped')} description={t('启动后可查看并更新订阅和规则集。', 'Start RouterClash to view and update subscriptions and rule sets.')} /></section>
        : <>
            <section className={styles.stack} aria-label={t('节点订阅', 'Node subscriptions')}>
              <h2 className={styles.cardTitle}>{t('节点订阅', 'Node subscriptions')}</h2>
              {subscriptions.length === 0
                ? <div className={styles.card}><EmptyState title={t('没有节点订阅', 'No node subscriptions')} description={t('当前配置没有使用 proxy-providers。', 'The current config has no proxy-providers.')} /></div>
                : <div className={styles.two}>
                    {subscriptions.map(item => {
                      const info = item.subscriptionInfo
                      return (
                        <div key={item.name} className={styles.card}>
                          <div className={styles.spread}>
                            <div className={styles.rowMain}>
                              <span className={styles.rowName}>{item.name}</span>
                              <span className={styles.rowMeta}>{summary(item)}</span>
                            </div>
                            <div className={styles.actions}>
                              <Button size="sm" variant="ghost" loading={checking === item.name} onClick={() => check(item.name)}>{t('测速', 'Test')}</Button>
                              {item.vehicleType === 'HTTP' && <Button size="sm" variant="secondary" loading={updating === key('proxies', item.name)} onClick={() => update('proxies', item.name)}>{t('更新', 'Update')}</Button>}
                            </div>
                          </div>
                          {!!info?.Total && (
                            <div className={styles.quota}>
                              <div className={styles.quotaGauge}>
                                <Gauge
                                  label={t('已用流量', 'Traffic used')}
                                  value={Math.min(100, (info.Upload + info.Download) / info.Total * 100)}
                                  detail={`${bytes(info.Upload + info.Download)} / ${bytes(info.Total)}`}
                                  thresholds={[
                                    { from: 0, tone: 'success', label: t('充足', 'Plenty left') },
                                    { from: 70, tone: 'warning', label: t('偏高', 'Running low') },
                                    { from: 90, tone: 'danger', label: t('即将用完', 'Almost used up') },
                                  ]}
                                />
                              </div>
                              <dl className={styles.details}>
                                <dt>{t('已下载', 'Downloaded')}</dt><dd>{bytes(info.Download)}</dd>
                                <dt>{t('已上传', 'Uploaded')}</dt><dd>{bytes(info.Upload)}</dd>
                                <dt>{t('剩余', 'Remaining')}</dt><dd>{bytes(Math.max(0, info.Total - info.Upload - info.Download))}</dd>
                              </dl>
                            </div>
                          )}
                          {!!info?.Expire && <p className={styles.hint}>{t(`到期时间：${new Date(info.Expire * 1000).toLocaleDateString()}`, `Expires ${new Date(info.Expire * 1000).toLocaleDateString()}`)}</p>}
                        </div>
                      )
                    })}
                  </div>}
            </section>
            <section className={styles.card} aria-label={t('规则集', 'Rule sets')}>
              <h2 className={styles.cardTitle}>{t('规则集', 'Rule sets')}</h2>
              <div className={styles.tableScroll}>
                <SortableDataTable
                  rows={rows}
                  rowKey="name"
                  caption={t('规则集', 'Rule sets')}
                  emptyMessage={t('当前配置没有使用规则集', 'This config has no rule sets')}
                  defaultSort={{ key: 'count', direction: 'desc' }}
                  columns={[
                    { key: 'name', label: t('名称', 'Name'), sortable: true },
                    { key: 'info', label: t('格式', 'Format') },
                    { key: 'count', label: t('条目', 'Entries'), numeric: true, sortable: true },
                    { key: 'updated', label: t('更新时间', 'Updated') },
                    { key: 'vehicle', label: '', render: (_, row) => row.vehicle === 'HTTP' ? <Button size="sm" variant="ghost" loading={updating === key('rules', row.name)} onClick={() => update('rules', row.name)}>{t('更新', 'Update')}</Button> : null },
                  ]}
                />
              </div>
            </section>
          </>}
    </main>
  )
}
