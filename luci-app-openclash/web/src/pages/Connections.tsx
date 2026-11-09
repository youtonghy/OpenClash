import { useMemo, useRef, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { ConfirmMorph } from '@/components/arc/confirm-morph/confirm-morph'
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { MorphSelect, type MorphSelectOption } from '@/components/arc/morph-select/morph-select'
import { Pagination } from '@/components/arc/pagination/pagination'
import { SearchField } from '@/components/arc/search-field/search-field'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { SortableDataTable, type SortDirection, type SortState } from '@/components/arc/sortable-data-table/sortable-data-table'
import { apiGet, bytes, isRunning, type Status } from '@/lib/api'
import { t } from '@/lib/i18n'
import { mihomoFetch, useMihomoStream, usePolling, type Connection, type Snapshot } from '@/lib/mihomo'
import styles from './layout.module.css'

type View = 'active' | 'closed'
type FilterKey = 'source' | 'rule' | 'group' | 'node' | 'network'
type DeviceNames = Record<string, string>
type Row = Record<FilterKey, string> & {
  id: string
  device?: string
  host: string
  port: string
  ruleName: string
  chain: string
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
const ALL = '__all__'
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Keeps the last two groups of a long IPv6 address, which is enough to tell devices apart. */
function shortIp(ip: string) {
  const address = ip.replace(/^::ffff:/i, '')
  if (!address.includes(':') || address.length <= 16) return address
  const groups = address.split(':')
  return `…:${groups.at(-2)}:${groups.at(-1)}`
}

const bracket = (ip: string) => (ip.includes(':') ? `[${ip}]` : ip)

const filterFields: { key: FilterKey; all: string; format?: (value: string) => string }[] = [
  { key: 'source', all: t('全部来源', 'All sources'), format: shortIp },
  { key: 'rule', all: t('全部规则', 'All rules') },
  { key: 'group', all: t('全部策略组', 'All groups') },
  { key: 'node', all: t('全部节点', 'All nodes') },
  { key: 'network', all: t('全部协议', 'All protocols') },
]

/** Each field opens in the direction people usually want it: busiest first, names from A. */
const sortFields: { key: string; label: string; direction: SortDirection }[] = [
  { key: 'age', label: t('按时长', 'By duration'), direction: 'asc' },
  { key: 'downSpeed', label: t('按下载速度', 'By download speed'), direction: 'desc' },
  { key: 'upSpeed', label: t('按上传速度', 'By upload speed'), direction: 'desc' },
  { key: 'download', label: t('按下载流量', 'By downloaded'), direction: 'desc' },
  { key: 'upload', label: t('按上传流量', 'By uploaded'), direction: 'desc' },
  { key: 'host', label: t('按目标', 'By destination'), direction: 'asc' },
  { key: 'source', label: t('按来源', 'By source'), direction: 'asc' },
  { key: 'node', label: t('按节点', 'By node'), direction: 'asc' },
]

function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return t(`${s}秒`, `${s}s`)
  if (s < 3600) return t(`${Math.floor(s / 60)}分${s % 60}秒`, `${Math.floor(s / 60)}m ${s % 60}s`)
  return t(`${Math.floor(s / 3600)}时${Math.floor(s / 60) % 60}分`, `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`)
}

function toRow(c: Connection, previous: Row | undefined, seconds: number, now: number, devices: DeviceNames): Row {
  const m = c.metadata
  const rate = (value: number, before?: number) => (before === undefined || seconds <= 0 ? 0 : Math.max(0, value - before) / seconds)
  const host = m.host || bracket(shortIp(m.destinationIP))
  const rule = c.rulePayload ? `${c.rule}: ${c.rulePayload}` : c.rule
  const chains = c.chains ?? []
  const device = m.sourceIP ? devices[m.sourceIP] : t('路由器', 'Router')
  const source = device ?? m.sourceIP
  // the controller lists the chain from the exit node back to the matched group
  const chain = [...chains].reverse().join(' → ')
  return {
    id: c.id,
    device,
    host,
    port: m.destinationPort,
    network: m.network.toUpperCase(),
    source,
    rule,
    ruleName: c.rulePayload || c.rule,
    node: chains[0] ?? 'DIRECT',
    group: chains.at(-1) ?? 'DIRECT',
    chain,
    upSpeed: rate(c.upload, previous?.upload),
    downSpeed: rate(c.download, previous?.download),
    upload: c.upload,
    download: c.download,
    age: (now - new Date(c.start).getTime()) / 1000,
    search: [host, m.host, m.destinationIP, m.sniffHost, rule, chain, device, m.sourceIP, m.process, m.network].join(' ').toLowerCase(),
    raw: c,
  }
}

const speed = (value: number) => `${bytes(value)}/s`

function Pair({ down, up, idle }: { down: string; up: string; idle?: boolean }) {
  return <span className={styles.pair} data-idle={idle || undefined}><span aria-label={t('下载', 'Download')}>↓ {down}</span><span aria-label={t('上传', 'Upload')}>↑ {up}</span></span>
}

export function Connections({ status }: { status?: Status }) {
  const running = isRunning(status)
  const [active, setActive] = useState<Row[]>([])
  const [closed, setClosed] = useState<Row[]>([])
  const [view, setView] = useState<View>('active')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({})
  const [paused, setPaused] = useState(false)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<SortState>({ key: 'age', direction: 'asc' })
  // the table only reads its sort on mount, so the toolbar remounts it to apply a new one
  const [sortVersion, setSortVersion] = useState(0)
  const [devices, setDevices] = useState<DeviceNames>({})
  const [devicesError, setDevicesError] = useState<string | null>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const previous = useRef<{ at: number; rows: Map<string, Row> }>({ at: 0, rows: new Map() })

  usePolling(() => {
    apiGet<DeviceNames>('device_names')
      .then(names => {
        setDevices(names)
        setDevicesError(null)
      })
      .catch(err => setDevicesError((err as Error).message))
  }, 60000, running)

  useMihomoStream<Snapshot>(status, '/connections?interval=2000', running && !paused, data => {
    const now = Date.now()
    const last = previous.current
    const seconds = last.at ? (now - last.at) / 1000 : 0
    const rows = (data.connections ?? []).map(item => toRow(item, last.rows.get(item.id), seconds, now, devices))
    const live = new Set(rows.map(row => row.id))
    const gone = [...last.rows.values()].filter(row => !live.has(row.id)).map(row => ({ ...row, upSpeed: 0, downSpeed: 0 }))
    previous.current = { at: now, rows: new Map(rows.map(row => [row.id, row])) }
    setActive(rows)
    if (gone.length) setClosed(list => [...gone, ...list].slice(0, CLOSED_LIMIT))
  })

  const source = view === 'active' ? active : closed
  const filterCount = Object.keys(filters).length
  const filtering = query.trim() !== '' || filterCount > 0

  const filterItems = useMemo(() => {
    const items = {} as Record<FilterKey, MorphSelectOption[]>
    for (const field of filterFields) {
      const counts = new Map<string, number>()
      for (const row of source) counts.set(row[field.key], (counts.get(row[field.key]) ?? 0) + 1)
      // a chosen value stays listed after its last connection ends
      const chosen = filters[field.key]
      if (chosen && !counts.has(chosen)) counts.set(chosen, 0)
      items[field.key] = [
        { value: ALL, label: field.all },
        ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: field.format?.(value) ?? value, meta: String(count), keywords: value })),
      ]
    }
    return items
  }, [source, filters])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = source.filter(row =>
      filterFields.every(field => !filters[field.key] || row[field.key] === filters[field.key]) && (!needle || row.search.includes(needle)))
    const key = sort.key as keyof Row
    const direction = sort.direction === 'asc' ? 1 : -1
    return matched.sort((a, b) => {
      const left = a[key]
      const right = b[key]
      return direction * (typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right)))
    })
  }, [source, filters, query, sort])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const rows = useMemo(() => visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [visible, currentPage])
  const totals = useMemo(() => active.reduce((sum, row) => ({ up: sum.up + row.upSpeed, down: sum.down + row.downSpeed }), { up: 0, down: 0 }), [active])
  const detail = active.find(row => row.id === detailId) ?? closed.find(row => row.id === detailId)

  const setFilter = (key: FilterKey, value: string) => {
    setFilters(current => {
      const next = { ...current }
      if (value === ALL) delete next[key]
      else next[key] = value
      return next
    })
    setPage(1)
  }

  const applySort = (next: SortState) => {
    setSort(next)
    setSortVersion(version => version + 1)
    setPage(1)
  }

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
        [t('目标', 'Destination'), `${detail.raw.metadata.host || bracket(detail.raw.metadata.destinationIP)}:${detail.port}`],
        [t('目标 IP', 'Destination IP'), detail.raw.metadata.destinationIP],
        [t('嗅探域名', 'Sniffed host'), detail.raw.metadata.sniffHost],
        [t('设备', 'Device'), detail.device],
        [t('来源', 'Source'), [detail.raw.metadata.sourceIP, detail.raw.metadata.sourcePort && `${t('端口', 'port')} ${detail.raw.metadata.sourcePort}`].filter(Boolean).join(', ')],
        [t('网络', 'Network'), [detail.network, detail.raw.metadata.type].filter(Boolean).join(' · ')],
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
      {devicesError && <Alert tone="warning" title={t('无法读取设备名称，暂时显示地址', 'Could not load device names, showing addresses for now')}>{devicesError}</Alert>}
      <section className={styles.card}>
        {!running
          ? <EmptyState title={t('内核未运行', 'Core is stopped')} description={t('启动 RouterClash 后这里会显示实时连接。', 'Start RouterClash to see live connections.')} />
          : <>
              <div className={styles.toolbar}>
                <SegmentedControl
                  label={t('连接状态', 'Connection state')}
                  value={view}
                  onValueChange={value => { setView(value as View); setPage(1) }}
                  options={[{ value: 'active', label: t(`活动 ${active.length}`, `Active ${active.length}`) }, { value: 'closed', label: t(`已关闭 ${closed.length}`, `Closed ${closed.length}`) }]}
                />
                <div className={styles.grow}><SearchField label="" aria-label={t('搜索连接', 'Search connections')} placeholder={t('域名、IP、规则或节点', 'Host, IP, rule or node')} value={query} onValueChange={value => { setQuery(value); setPage(1) }} /></div>
                <div className={styles.filters}>
                  <MorphSelect
                    label={t('排序方式', 'Sort by')}
                    hideLabel
                    align="end"
                    searchable={false}
                    value={sort.key}
                    items={sortFields.map(field => ({ value: field.key, label: field.label }))}
                    onValueChange={key => applySort({ key, direction: sortFields.find(field => field.key === key)?.direction ?? 'asc' })}
                  />
                  <Button variant="ghost" onClick={() => applySort({ key: sort.key, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}>{sort.direction === 'asc' ? t('升序', 'Ascending') : t('降序', 'Descending')}</Button>
                </div>
              </div>
              <div className={styles.filters}>
                {filterFields.map(field => (
                  <MorphSelect
                    key={field.key}
                    label={field.all}
                    hideLabel
                    panelWidth={300}
                    searchPlaceholder={t('搜索', 'Search')}
                    value={filters[field.key] ?? ALL}
                    items={filterItems[field.key]}
                    onValueChange={value => setFilter(field.key, value)}
                  />
                ))}
                {filterCount > 0 && <Button variant="ghost" onClick={() => { setFilters({}); setPage(1) }}>{t('清除筛选', 'Clear filters')}</Button>}
              </div>
              <div className={styles.tableScroll}>
                <SortableDataTable
                  key={sortVersion}
                  rows={rows}
                  rowKey="id"
                  caption={t('连接', 'Connections')}
                  emptyMessage={filtering ? t('没有匹配的连接', 'No matching connections') : view === 'active' ? t('暂无活动连接', 'No active connections') : t('打开此页后还没有连接关闭', 'No connections have closed since this page opened')}
                  defaultSort={sort}
                  onSortChange={next => { setSort(next); setPage(1) }}
                  columns={[
                    { key: 'host', label: t('目标', 'Destination'), render: (_, row) => (
                      <button type="button" className={styles.cellButton} title={`${row.raw.metadata.host || bracket(row.raw.metadata.destinationIP)}:${row.port}\n${row.raw.metadata.sourceIP}`} onClick={() => openDetail(row.id)}>
                        <span className={styles.cellMain}>{row.host}<span className={styles.cellPort}>:{row.port}</span></span>
                        <span className={styles.cellSource}>
                          {row.device ? <span className={styles.cellMain}>{row.device}</span> : <Badge size="sm" pill>{shortIp(row.source)}</Badge>}
                          <span>· {row.network}</span>
                        </span>
                      </button>
                    ) },
                    { key: 'node', label: t('节点与规则', 'Node and rule'), width: 184, render: (_, row) => (
                      <span className={styles.cell} title={`${row.chain}\n${row.rule}`}>
                        <span className={styles.cellMain}>{row.node}</span>
                        <span className={styles.cellSub}>{[row.group !== row.node && row.group, row.ruleName].filter(Boolean).join(' · ')}</span>
                      </span>
                    ) },
                    ...(view === 'active' ? [{ key: 'downSpeed', label: t('速度', 'Speed'), numeric: true, width: 122, render: (_: unknown, row: Row) => <Pair down={speed(row.downSpeed)} up={speed(row.upSpeed)} idle={row.downSpeed + row.upSpeed === 0} /> }] : []),
                    { key: 'download', label: t('流量', 'Traffic'), numeric: true, width: 104, render: (_, row) => <Pair down={bytes(row.download)} up={bytes(row.upload)} /> },
                    { key: 'age', label: t('时长', 'Duration'), numeric: true, width: 96, render: value => <span className={styles.nowrap}>{duration(value as number)}</span> },
                    { key: 'id', label: '', sortable: false, width: 88, render: (_, row) => (view === 'active'
                      ? <Button size="sm" variant="ghost" loading={closing === row.id} onClick={() => closeOne(row.id)}>{t('断开', 'Close')}</Button>
                      : null) },
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
