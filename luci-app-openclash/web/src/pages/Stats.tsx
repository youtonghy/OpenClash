import { useCallback, useMemo, useState } from 'react'
import { TrafficGlobe } from '@/components/arc/blocks/revenue-globe/revenue-globe'
import { UptimeStatus } from '@/components/arc/blocks/uptime-status/uptime-status'
import type { RoundStatus, UptimeRound, UptimeService } from '@/components/arc/blocks/uptime-status/uptime-data'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Ridgeline } from '@/components/arc/ridgeline/ridgeline'
import { SankeyFlow } from '@/components/arc/sankey-flow/sankey-flow'
import { SplitBar, type SplitSegment } from '@/components/arc/split-bar/split-bar'
import { SortableDataTable } from '@/components/arc/sortable-data-table/sortable-data-table'
import { bytes, isRunning, type Status } from '@/lib/api'
import { locale, t } from '@/lib/i18n'
import { fetchProxies, proxyGroups, useMihomoStream, usePolling, type Connection, type ProxyMap, type ProxyNode, type Snapshot } from '@/lib/mihomo'
import styles from './layout.module.css'

type Measure = 'traffic' | 'count'
type Ridge = 'latency' | 'size'
type Series = { id: string; label: string; values: number[] }
const LIMIT = 6
const RIDGES = 12
const UPTIME_ROWS = 12
// probes of one round land within seconds of each other, and test intervals are minutes apart
const ROUND_GAP = 30000
const SLOW_MS = 800

const weight = (c: Connection, measure: Measure) => (measure === 'count' ? 1 : c.upload + c.download)
// the controller lists the chain from the exit node back to the matched group
const outbound = (c: Connection) => c.chains?.[0] ?? 'DIRECT'
const policy = (c: Connection) => c.chains?.[c.chains.length - 1] ?? 'DIRECT'
const ruleName = (c: Connection) => (c.rulePayload ? `${c.rule}: ${c.rulePayload}` : c.rule)

/** Keeps the largest keys and folds the rest into one bucket, so a busy network stays readable. */
function topKeys(items: Connection[], key: (c: Connection) => string, measure: Measure) {
  const totals = new Map<string, number>()
  for (const item of items) totals.set(key(item), (totals.get(key(item)) ?? 0) + weight(item, measure))
  return new Set([...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, LIMIT).map(([name]) => name))
}

function flows(items: Connection[], measure: Measure) {
  const sources = topKeys(items, c => c.metadata.sourceIP || 'router', measure)
  const rules = topKeys(items, ruleName, measure)
  const targets = topKeys(items, policy, measure)
  const other = t('其他', 'Other')
  const links = new Map<string, number>()
  const nodes = new Map<string, { id: string; label: string; column: number }>()
  const node = (column: number, label: string) => {
    const id = `${column}:${label}`
    if (!nodes.has(id)) nodes.set(id, { id, label, column })
    return id
  }
  const link = (a: string, b: string, value: number) => links.set(`${a}\u0000${b}`, (links.get(`${a}\u0000${b}`) ?? 0) + value)
  for (const item of items) {
    const value = weight(item, measure)
    if (!value) continue
    const sourceName = item.metadata.sourceIP || 'router'
    const a = node(0, sources.has(sourceName) ? sourceName : other)
    const b = node(1, rules.has(ruleName(item)) ? ruleName(item) : other)
    const c = node(2, targets.has(policy(item)) ? policy(item) : other)
    link(a, b, value)
    link(b, c, value)
  }
  return {
    nodes: [...nodes.values()],
    links: [...links.entries()].map(([key, value]) => {
      const [source, target] = key.split('\u0000')
      return { source, target, value }
    }),
  }
}

function shares(items: Connection[], measure: Measure): SplitSegment[] {
  const totals = new Map<string, number>()
  // bytes read better as MB in the readout
  const scale = measure === 'count' ? 1 : 1048576
  for (const item of items) totals.set(outbound(item), (totals.get(outbound(item)) ?? 0) + weight(item, measure) / scale)
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const head = sorted.slice(0, 5).map(([id, value]) => ({ id, label: id, value }))
  const rest = sorted.slice(5).reduce((sum, [, value]) => sum + value, 0)
  return rest ? [...head, { id: 'other', label: t('其他', 'Other'), value: rest }] : head
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function samplesOf(group: ProxyNode, proxies: ProxyMap) {
  const url = group.testUrl
  return (group.all ?? []).flatMap(name => {
    const node = proxies[name]
    if (!node || node.all?.length) return []
    const extra = url ? node.extra?.[url]?.history : undefined
    return (extra?.length ? extra : node.history ?? []).flatMap(item => (item.time ? [{ time: new Date(item.time).getTime(), delay: item.delay }] : []))
  }).sort((a, b) => a.time - b.time)
}

function roundsOf(samples: { time: number; delay: number }[]): UptimeRound[] {
  const rounds: { time: number; delay: number }[][] = []
  samples.forEach((sample, index) => {
    if (index === 0 || sample.time - samples[index - 1].time > ROUND_GAP) rounds.push([])
    rounds[rounds.length - 1].push(sample)
  })
  return rounds.map(round => {
    const alive = round.filter(sample => sample.delay > 0).map(sample => sample.delay)
    const delay = alive.length ? median(alive) : undefined
    const status: RoundStatus = !alive.length ? 'outage' : alive.length / round.length < .7 || (delay ?? 0) >= SLOW_MS ? 'degraded' : 'operational'
    return { status, time: round[round.length - 1].time, ok: alive.length, total: round.length, delay }
  })
}

const typeNames: Record<string, string> = { Selector: t('手动选择', 'Manual'), URLTest: t('自动选择', 'Auto'), Fallback: t('故障转移', 'Fallback'), LoadBalance: t('负载均衡', 'Load balance') }

function health(proxies: ProxyMap) {
  const services: UptimeService[] = []
  const latency: Series[] = []
  for (const group of proxyGroups(proxies)) {
    const samples = samplesOf(group, proxies)
    if (!samples.length) continue
    services.push({ id: group.name, name: group.name, detail: typeNames[group.type] ?? group.type, rounds: roundsOf(samples) })
    latency.push({ id: group.name, label: group.name, values: samples.filter(sample => sample.delay > 0).map(sample => sample.delay) })
  }
  return { services, latency }
}

/** A ridge needs several different values to have a shape, and only so many ridges stay readable. */
const ridgesOf = (series: Series[]) => series.filter(item => new Set(item.values).size >= 2).sort((a, b) => b.values.length - a.values.length).slice(0, RIDGES)

export function Stats({ status }: { status?: Status }) {
  const running = isRunning(status)
  const [items, setItems] = useState<Connection[]>([])
  const [measure, setMeasure] = useState<Measure>('traffic')
  const [proxies, setProxies] = useState<ProxyMap | null>(null)
  const [proxiesError, setProxiesError] = useState<string | null>(null)
  const [ridge, setRidge] = useState<Ridge>('latency')
  const [allRows, setAllRows] = useState(false)
  useMihomoStream<Snapshot>(status, '/connections?interval=4000', running, data => setItems(data.connections ?? []))

  const loadProxies = useCallback(() => {
    if (!status) return
    fetchProxies(status)
      .then(data => {
        setProxies(data)
        setProxiesError(null)
      })
      .catch(err => setProxiesError((err as Error).message))
  }, [status])
  usePolling(loadProxies, 30000, running)

  const groupHealth = useMemo(() => (proxies ? health(proxies) : { services: [], latency: [] }), [proxies])
  const shownServices = allRows ? groupHealth.services : groupHealth.services.slice(0, UPTIME_ROWS)
  const ridges = useMemo(() => {
    if (ridge === 'latency') return ridgesOf(groupHealth.latency)
    const byGroup = new Map<string, number[]>()
    // sizes span many orders of magnitude, so each connection is plotted by its log
    for (const item of items) byGroup.set(policy(item), [...(byGroup.get(policy(item)) ?? []), Math.log10(item.upload + item.download + 1)])
    return ridgesOf([...byGroup].map(([name, values]) => ({ id: name, label: name, values })))
  }, [ridge, groupHealth.latency, items])

  const flow = useMemo(() => flows(items, measure), [items, measure])
  const split = useMemo(() => shares(items, measure), [items, measure])
  const rows = useMemo(() => {
    const hosts = new Map<string, { id: string; host: string; policy: string; count: number; traffic: number }>()
    for (const item of items) {
      const host = item.metadata.host || item.metadata.destinationIP
      const row = hosts.get(host) ?? { id: host, host, policy: policy(item), count: 0, traffic: 0 }
      row.count += 1
      row.traffic += item.upload + item.download
      hosts.set(host, row)
    }
    return [...hosts.values()].sort((a, b) => b.traffic - a.traffic).slice(0, 50)
  }, [items])

  const format = measure === 'count' ? undefined : (value: number) => bytes(value)
  const unit = measure === 'count' ? t('条连接', 'connections') : ''

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('统计', 'Statistics')}</h1>
          <p className={styles.sub}>{t('基于当前活动连接实时计算', 'Calculated live from active connections')}</p>
        </div>
        <SegmentedControl label={t('统计方式', 'Measure')} value={measure} onValueChange={value => setMeasure(value as Measure)} options={[{ value: 'traffic', label: t('流量', 'Traffic') }, { value: 'count', label: t('连接数', 'Connections') }]} />
      </header>

      {!running
        ? <section className={styles.card}><EmptyState title={t('内核未运行', 'Core is stopped')} description={t('启动 RouterClash 后这里会显示实时分流情况。', 'Start RouterClash to see how traffic is routed.')} /></section>
        : <>
            <section className={styles.card} aria-label={t('流向', 'Flow')}>
              <h2 className={styles.cardTitle}>{t('流量去向', 'Where traffic goes')}</h2>
              {flow.links.length === 0
                ? <EmptyState title={t('暂无连接', 'No connections yet')} description={t('有流量经过时，这里会显示实时去向。', 'Traffic appears here as it flows.')} />
                : <SankeyFlow nodes={flow.nodes} links={flow.links} label={t('设备到规则到策略组的流向', 'Flow from devices through rules to policies')} columns={[t('设备', 'Device'), t('规则', 'Rule'), t('策略组', 'Policy')]} unit={unit} formatValue={format} totalLabel={t('全部', 'the total')} emptyLabel={t('暂无连接', 'No connections yet')} height={380} />}
            </section>
            <TrafficGlobe connections={items} />
            {proxiesError && <section className={styles.card}><EmptyState title={t('读取节点数据失败', 'Could not load node data')} description={proxiesError} /></section>}
            {groupHealth.services.length > 0
              ? <UptimeStatus
                  services={shownServices}
                  footer={groupHealth.services.length > UPTIME_ROWS && <Button size="sm" variant="ghost" onClick={() => setAllRows(value => !value)}>{allRows ? t('收起', 'Show fewer') : t(`显示全部 ${groupHealth.services.length} 个策略组`, `Show all ${groupHealth.services.length} groups`)}</Button>}
                />
              : !proxiesError && <section className={styles.card}><EmptyState title={t('还没有测速记录', 'No test results yet')} description={t('在策略组页点一次测速，这里就会显示可用性。', 'Run a test on the proxy groups page to see availability here.')} /></section>}
            <section className={styles.card} aria-label={t('分布', 'Distribution')}>
              <div className={styles.spread}>
                <h2 className={styles.cardTitle}>{ridge === 'latency' ? t('各策略组的节点延迟分布', 'Node delay by group') : t('各策略组的单条连接流量分布', 'Traffic per connection by group')}</h2>
                <SegmentedControl label={t('分布指标', 'Distribution measure')} value={ridge} onValueChange={value => setRidge(value as Ridge)} options={[{ value: 'latency', label: t('节点延迟', 'Node delay') }, { value: 'size', label: t('连接流量', 'Connection size') }]} />
              </div>
              {ridges.length === 0
                ? <EmptyState title={t('数据还不够', 'Not enough data yet')} description={ridge === 'latency' ? t('测速几次之后这里会显示分布。', 'Run a few tests to see the distribution.') : t('有更多连接之后这里会显示分布。', 'The distribution appears as connections build up.')} />
                : <Ridgeline series={ridges} label={ridge === 'latency' ? t('各策略组的节点延迟分布', 'Node delay by group') : t('各策略组的单条连接流量分布', 'Traffic per connection by group')} domain={[0, Math.max(...ridges.flatMap(item => item.values)) * 1.05]} {...(ridge === 'latency' ? { unit: ' ms' } : { formatValue: (value: number) => bytes(10 ** value) })} emptyLabel={t('暂无数据', 'No data yet')} />}
            </section>
            <section className={styles.card} aria-label={t('出口占比', 'Exit share')}>
              <SplitBar title={t('出口节点占比', 'Share by exit node')} segments={split} locale={locale} unit={measure === 'count' ? unit : 'MB'} totalLabel={t('合计', 'Total')} format={measure === 'count' ? undefined : { maximumFractionDigits: 1 }} />
            </section>
            <section className={styles.card} aria-label={t('活跃域名', 'Active hosts')}>
              <div className={styles.tableScroll}>
                <SortableDataTable
                  rows={rows}
                  rowKey="id"
                  caption={t('活跃域名', 'Active hosts')}
                  emptyMessage={t('暂无连接', 'No connections yet')}
                  defaultSort={{ key: 'traffic', direction: 'desc' }}
                  columns={[
                    { key: 'host', label: t('域名或地址', 'Host') },
                    { key: 'policy', label: t('策略组', 'Policy') },
                    { key: 'count', label: t('连接', 'Connections'), numeric: true, sortable: true },
                    { key: 'traffic', label: t('流量', 'Traffic'), numeric: true, sortable: true, render: value => bytes(value as number) },
                  ]}
                />
              </div>
            </section>
          </>}
    </main>
  )
}
