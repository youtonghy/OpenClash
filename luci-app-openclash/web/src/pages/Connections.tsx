import { useMemo, useRef, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { ConfirmMorph } from '@/components/arc/confirm-morph/confirm-morph'
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Pagination } from '@/components/arc/pagination/pagination'
import { SearchField } from '@/components/arc/search-field/search-field'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { SortableDataTable, type SortState } from '@/components/arc/sortable-data-table/sortable-data-table'
import { bytes, isRunning, type Status } from '@/lib/api'
import { t } from '@/lib/i18n'
import { mihomoFetch, useMihomoStream, type Connection, type Snapshot } from '@/lib/mihomo'
import styles from './layout.module.css'

type View = 'active' | 'closed'
type Row = {
  id: string
  host: string
  rule: string
  chain: string
  source: string
  upSpeed: number
  downSpeed: number
  upload: number
  download: number
  age: number
  search: string
  raw: Connection
}

const PAGE_SIZE = 50
const CLOSED_LIMIT = 500
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return t(`${s} 秒`, `${s}s`)
  if (s < 3600) return t(`${Math.floor(s / 60)} 分 ${s % 60} 秒`, `${Math.floor(s / 60)}m ${s % 60}s`)
  return t(`${Math.floor(s / 3600)} 时 ${Math.floor(s / 60) % 60} 分`, `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`)
}

function toRow(c: Connection, previous: Row | undefined, seconds: number, now: number): Row {
  const m = c.metadata
  const rate = (value: number, before?: number) => (before === undefined || seconds <= 0 ? 0 : Math.max(0, value - before) / seconds)
  const host = `${m.host || m.destinationIP}:${m.destinationPort}`
  const rule = c.rulePayload ? `${c.rule}: ${c.rulePayload}` : c.rule
  // the controller lists the chain from the exit node back to the matched group
  const chain = [...(c.chains ?? [])].reverse().join(' → ')
  const source = m.sourceIP || t('路由器', 'Router')
  return {
    id: c.id,
    host,
    rule,
    chain,
    source,
    upSpeed: rate(c.upload, previous?.upload),
    downSpeed: rate(c.download, previous?.download),
    upload: c.upload,
    download: c.download,
    age: (now - new Date(c.start).getTime()) / 1000,
    search: [host, m.destinationIP, m.sniffHost, rule, chain, source, m.process, m.network].join(' ').toLowerCase(),
    raw: c,
  }
}

const speed = (value: unknown) => `${bytes(value as number)}/s`

function Pair({ down, up }: { down: string; up: string }) {
  return <span className={styles.pair}><span aria-label={t('下载', 'Download')}>↓ {down}</span><span aria-label={t('上传', 'Upload')}>↑ {up}</span></span>
}

export function Connections({ status }: { status?: Status }) {
  const running = isRunning(status)
  const [active, setActive] = useState<Row[]>([])
  const [closed, setClosed] = useState<Row[]>([])
  const [view, setView] = useState<View>('active')
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<SortState>({ key: 'age', direction: 'asc' })
  const [closing, setClosing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const previous = useRef<{ at: number; rows: Map<string, Row> }>({ at: 0, rows: new Map() })

  useMihomoStream<Snapshot>(status, '/connections?interval=2000', running && !paused, data => {
    const now = Date.now()
    const last = previous.current
    const seconds = last.at ? (now - last.at) / 1000 : 0
    const rows = (data.connections ?? []).map(item => toRow(item, last.rows.get(item.id), seconds, now))
    const live = new Set(rows.map(row => row.id))
    const gone = [...last.rows.values()].filter(row => !live.has(row.id)).map(row => ({ ...row, upSpeed: 0, downSpeed: 0 }))
    previous.current = { at: now, rows: new Map(rows.map(row => [row.id, row])) }
    setActive(rows)
    if (gone.length) setClosed(list => [...gone, ...list].slice(0, CLOSED_LIMIT))
  })

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const source = view === 'active' ? active : closed
    const matched = needle ? source.filter(row => row.search.includes(needle)) : source
    const key = sort.key as keyof Row
    const direction = sort.direction === 'asc' ? 1 : -1
    return [...matched].sort((a, b) => {
      const left = a[key]
      const right = b[key]
      return direction * (typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right)))
    })
  }, [active, closed, view, query, sort])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const rows = useMemo(() => visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [visible, currentPage])
  const filtering = query.trim() !== ''
  const totals = useMemo(() => active.reduce((sum, row) => ({ up: sum.up + row.upSpeed, down: sum.down + row.downSpeed }), { up: 0, down: 0 }), [active])
  const detail = active.find(row => row.id === detailId) ?? closed.find(row => row.id === detailId)

  const closeOne = (id: string) => {
    if (!status) return
    setClosing(id)
    setError(null)
    mihomoFetch(status, `/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .catch(err => setError((err as Error).message))
      .finally(() => setClosing(null))
  }

  const closeMany = async () => {
    if (!status) return
    if (!filtering) {
      await mihomoFetch(status, '/connections', { method: 'DELETE' })
      return
    }
    for (const row of visible) await mihomoFetch(status, `/connections/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
  }

  const openDetail = (id: string) => {
    setDetailId(id)
    setDrawerOpen(true)
  }

  const details: [string, string | undefined][] = detail
    ? [
        [t('目标', 'Destination'), detail.host],
        [t('目标 IP', 'Destination IP'), detail.raw.metadata.destinationIP],
        [t('嗅探域名', 'Sniffed host'), detail.raw.metadata.sniffHost],
        [t('来源', 'Source'), detail.raw.metadata.sourcePort ? `${detail.source}:${detail.raw.metadata.sourcePort}` : detail.source],
        [t('网络', 'Network'), [detail.raw.metadata.network, detail.raw.metadata.type].filter(Boolean).join(' · ')],
        [t('规则', 'Rule'), detail.rule],
        [t('代理链', 'Chain'), detail.chain],
        [t('出口地址', 'Exit address'), detail.raw.metadata.remoteDestination],
        [t('进程', 'Process'), detail.raw.metadata.processPath || detail.raw.metadata.process],
        [t('开始时间', 'Started'), new Date(detail.raw.start).toLocaleString()],
        [t('上传', 'Upload'), bytes(detail.upload)],
        [t('下载', 'Download'), bytes(detail.download)],
      ]
    : []

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('连接', 'Connections')}</h1>
          <p className={`${styles.sub} ${styles.numeric}`}>{t(`${active.length} 条活动连接 · 下载 ${speed(totals.down)} · 上传 ${speed(totals.up)}`, `${active.length} active · ${speed(totals.down)} down · ${speed(totals.up)} up`)}</p>
        </div>
        {running && (
          <div className={styles.tools}>
            <Button variant="secondary" onClick={() => setPaused(value => !value)}>{paused ? t('继续刷新', 'Resume updates') : t('暂停刷新', 'Pause updates')}</Button>
            {view === 'active' && visible.length > 0 && (
              <ConfirmMorph
                label={filtering ? t('断开筛选结果', 'Close filtered') : t('断开全部', 'Close all')}
                prompt={t(`断开 ${visible.length} 条连接？`, `Close ${visible.length} connections?`)}
                confirmLabel={t('断开', 'Close')}
                cancelLabel={t('取消', 'Cancel')}
                pendingLabel={t('正在断开', 'Closing')}
                doneLabel={t('已断开', 'Closed')}
                errorLabel={t('断开失败', 'Could not close')}
                retryLabel={t('重试', 'Retry')}
                onConfirm={closeMany}
              />
            )}
          </div>
        )}
      </header>
      {error && <Alert tone="danger" title={t('操作失败', 'That did not work')}>{error}</Alert>}
      <section className={styles.card}>
        {!running
          ? <EmptyState title={t('内核未运行', 'Core is stopped')} description={t('启动 RouterClash 后这里会显示实时连接。', 'Start RouterClash to see live connections.')} />
          : <>
              <div className={styles.spread}>
                <SegmentedControl
                  label={t('连接状态', 'Connection state')}
                  value={view}
                  onValueChange={value => { setView(value as View); setPage(1) }}
                  options={[{ value: 'active', label: t(`活动 ${active.length}`, `Active ${active.length}`) }, { value: 'closed', label: t(`已关闭 ${closed.length}`, `Closed ${closed.length}`) }]}
                />
                <div className={styles.grow}><SearchField label={t('搜索连接', 'Search connections')} placeholder={t('域名、IP、规则或节点', 'Host, IP, rule or node')} value={query} onValueChange={value => { setQuery(value); setPage(1) }} /></div>
              </div>
              <div className={styles.tableScroll}>
                <SortableDataTable
                  rows={rows}
                  rowKey="id"
                  caption={t('连接', 'Connections')}
                  emptyMessage={filtering ? t('没有匹配的连接', 'No matching connections') : view === 'active' ? t('暂无活动连接', 'No active connections') : t('打开此页后还没有连接关闭', 'No connections have closed since this page opened')}
                  defaultSort={sort}
                  onSortChange={next => { setSort(next); setPage(1) }}
                  columns={[
                    { key: 'host', label: t('目标', 'Destination') },
                    { key: 'source', label: t('来源', 'Source') },
                    { key: 'rule', label: t('规则', 'Rule') },
                    { key: 'chain', label: t('代理链', 'Chain') },
                    ...(view === 'active' ? [{ key: 'downSpeed', label: t('速度', 'Speed'), numeric: true, render: (_: unknown, row: Row) => <Pair down={speed(row.downSpeed)} up={speed(row.upSpeed)} /> }] : []),
                    { key: 'download', label: t('流量', 'Traffic'), numeric: true, render: (_, row) => <Pair down={bytes(row.download)} up={bytes(row.upload)} /> },
                    { key: 'age', label: t('时长', 'Duration'), numeric: true, render: value => duration(value as number) },
                    { key: 'id', label: '', sortable: false, width: 136, render: (_, row) => (
                      <div className={styles.rowActions}>
                        <Button size="sm" variant="ghost" onClick={() => openDetail(row.id)}>{t('详情', 'Details')}</Button>
                        {view === 'active' && <Button size="sm" variant="ghost" loading={closing === row.id} onClick={() => closeOne(row.id)}>{t('断开', 'Close')}</Button>}
                      </div>
                    ) },
                  ]}
                />
              </div>
              {pageCount > 1 && <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} label={t('连接分页', 'Connection pages')} />}
            </>}
      </section>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        {detail && (
          <DrawerContent title={detail.host} description={t('连接详情', 'Connection details')}>
            <dl className={styles.details}>
              {details.filter(([, value]) => value).map(([label, value]) => (
                <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </DrawerContent>
        )}
      </Drawer>
    </main>
  )
}
