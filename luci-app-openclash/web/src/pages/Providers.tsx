import { useCallback, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { SortableDataTable } from '@/components/arc/sortable-data-table/sortable-data-table'
import { isRunning, type Status } from '@/lib/api'
import { t } from '@/lib/i18n'
import { mihomoFetch, usePolling } from '@/lib/mihomo'
import styles from './layout.module.css'

type RuleProvider = { name: string; behavior: string; format: string; ruleCount: number; updatedAt: string; vehicleType: string }
type ProxyProvider = { name: string; vehicleType: string; proxies: unknown[]; updatedAt?: string }
type Row = { name: string; kind: string; info: string; count: number; updated: string; vehicle: string; path: string }

export function Providers({ status }: { status?: Status }) {
  const running = isRunning(status)
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!status) return
    Promise.all([
      mihomoFetch<{ providers: Record<string, RuleProvider> }>(status, '/providers/rules'),
      mihomoFetch<{ providers: Record<string, ProxyProvider> }>(status, '/providers/proxies'),
    ]).then(([rules, proxies]) => {
      const when = (value?: string) => (value && !value.startsWith('0001') ? new Date(value).toLocaleString() : '')
      setRows([
        ...Object.values(proxies.providers).filter(item => item.vehicleType !== 'Compatible').map(item => ({ name: item.name, kind: t('节点', 'Proxy'), info: item.vehicleType, count: item.proxies?.length ?? 0, updated: when(item.updatedAt), vehicle: item.vehicleType, path: 'proxies' })),
        ...Object.values(rules.providers).map(item => ({ name: item.name, kind: t('规则', 'Rule'), info: `${item.behavior} · ${item.format.replace('Rule', '')}`, count: item.ruleCount, updated: when(item.updatedAt), vehicle: item.vehicleType, path: 'rules' })),
      ])
      setError(null)
    }).catch(err => setError((err as Error).message))
  }, [status])
  usePolling(load, 30000, running)

  const update = (row: Row) => {
    if (!status) return
    setUpdating(row.name)
    mihomoFetch(status, `/providers/${row.path}/${encodeURIComponent(row.name)}`, { method: 'PUT' })
      .then(load)
      .catch(err => setError((err as Error).message))
      .finally(() => setUpdating(null))
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}><h1 className={styles.title}>{t('规则与节点集', 'Providers')}</h1></header>
      {error && <Alert tone="danger" title={t('读取失败', 'Could not load')}>{error}</Alert>}
      <section className={styles.card}>
        {!running
          ? <EmptyState title={t('内核未运行', 'Core is stopped')} description={t('启动后可查看并更新规则集。', 'Start OpenClash to view and update providers.')} />
          : <div className={styles.tableScroll}>
              <SortableDataTable
                rows={rows}
                rowKey="name"
                caption={t('规则与节点集', 'Providers')}
                emptyMessage={t('当前配置没有使用规则集', 'This config has no providers')}
                defaultSort={{ key: 'count', direction: 'desc' }}
                columns={[
                  { key: 'name', label: t('名称', 'Name'), sortable: true },
                  { key: 'kind', label: t('类型', 'Type') },
                  { key: 'info', label: t('格式', 'Format') },
                  { key: 'count', label: t('条目', 'Entries'), numeric: true, sortable: true },
                  { key: 'updated', label: t('更新时间', 'Updated') },
                  { key: 'vehicle', label: '', render: (_, row) => row.vehicle === 'HTTP' ? <Button size="sm" variant="ghost" loading={updating === row.name} onClick={() => update(row)}>{t('更新', 'Update')}</Button> : null },
                ]}
              />
            </div>}
      </section>
    </main>
  )
}
