import { useCallback, useMemo, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { RadioCards } from '@/components/arc/radio-cards/radio-cards'
import { SearchField } from '@/components/arc/search-field/search-field'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { isRunning, type Status } from '@/lib/api'
import { t } from '@/lib/i18n'
import { mihomoFetch, usePolling, type Snapshot } from '@/lib/mihomo'
import styles from './layout.module.css'

type History = { delay: number }[]
type ProxyNode = {
  name: string
  type: string
  now?: string
  all?: string[]
  hidden?: boolean
  fixed?: string
  testUrl?: string
  history?: History
  extra?: Record<string, { history?: History }>
}
type ProxyMap = Record<string, ProxyNode>

const GLOBAL = 'GLOBAL'
const TEST_URL = 'https://www.gstatic.com/generate_204'
const TEST_TIMEOUT = 5000

const typeLabels: Record<string, string> = {
  Selector: t('手动选择', 'Manual'),
  URLTest: t('自动选择', 'Auto'),
  Fallback: t('故障转移', 'Fallback'),
  LoadBalance: t('负载均衡', 'Load balance'),
}

const testUrl = (group: ProxyNode) => group.testUrl || TEST_URL
const canChoose = (group: ProxyNode) => group.type !== 'LoadBalance'
const path = (name: string) => `/proxies/${encodeURIComponent(name)}`

/** A group listed as a node reports the delay of the node it currently uses. */
function lastDelay(proxies: ProxyMap, name: string | undefined, url: string): number | undefined {
  const node = name ? proxies[name] : undefined
  if (node?.now) return lastDelay(proxies, node.now, url)
  const extra = node?.extra?.[url]?.history
  return (extra?.length ? extra : node?.history)?.at(-1)?.delay
}

function Delay({ value }: { value?: number }) {
  if (value === undefined) return null
  if (value === 0) return <Badge tone="danger">{t('超时', 'Timed out')}</Badge>
  return <Badge tone={value < 300 ? 'success' : value < 800 ? 'warning' : 'danger'}><span className={styles.numeric}>{value} ms</span></Badge>
}

export function Proxies({ status }: { status?: Status }) {
  const running = isRunning(status)
  const [proxies, setProxies] = useState<ProxyMap | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // survives closing so the drawer keeps its content while it slides out
  const [openName, setOpenName] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    if (!status) return Promise.resolve()
    return mihomoFetch<{ proxies: ProxyMap }>(status, '/proxies')
      .then(data => {
        setProxies(data.proxies)
        setLoadError(null)
      })
      .catch(err => setLoadError((err as Error).message))
  }, [status])
  usePolling(load, 15000, running)

  const groups = useMemo(() => {
    if (!proxies) return []
    const order = proxies[GLOBAL]?.all ?? []
    const rank = (name: string) => {
      const index = order.indexOf(name)
      return index === -1 ? order.length : index
    }
    const showGlobal = status?.rule_mode === 'global'
    return Object.values(proxies)
      .filter(item => item.all?.length && !item.hidden && (item.name !== GLOBAL || showGlobal))
      .sort((a, b) => (a.name === GLOBAL ? -1 : b.name === GLOBAL ? 1 : rank(a.name) - rank(b.name)))
  }, [proxies, status?.rule_mode])

  const fail = (err: unknown) => setActionError((err as Error).message)

  const select = (groupName: string, node: string) => {
    if (!status) return Promise.resolve()
    return mihomoFetch(status, path(groupName), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: node }) })
  }

  /** Existing connections keep their old node until they close, so a switch would not take effect for them. */
  const closeGroupConnections = async (groupName: string) => {
    if (!status) return
    const snapshot = await mihomoFetch<Snapshot>(status, '/connections')
    await Promise.all((snapshot.connections ?? [])
      .filter(connection => connection.chains?.includes(groupName))
      // a connection can end by itself between the snapshot and the close
      .map(connection => mihomoFetch(status, `/connections/${encodeURIComponent(connection.id)}`, { method: 'DELETE' }).catch(() => undefined)))
  }

  const choose = async (group: ProxyNode, node: string) => {
    if (node === group.now) return
    setBusy(true)
    setActionError(null)
    try {
      await select(group.name, node)
      await closeGroupConnections(group.name)
    } catch (err) {
      fail(err)
    } finally {
      await load()
      setBusy(false)
    }
  }

  const unpin = async (group: ProxyNode) => {
    if (!status) return
    setBusy(true)
    setActionError(null)
    try {
      await mihomoFetch(status, path(group.name), { method: 'DELETE' })
    } catch (err) {
      fail(err)
    } finally {
      await load()
      setBusy(false)
    }
  }

  const test = async (group: ProxyNode) => {
    if (!status) return
    setTesting(group.name)
    setActionError(null)
    try {
      // 504 means every node timed out, and each timeout is already recorded in its history
      await mihomoFetch(status, `/group/${encodeURIComponent(group.name)}/delay?url=${encodeURIComponent(testUrl(group))}&timeout=${TEST_TIMEOUT}`)
        .catch(err => { if ((err as Error).message !== 'HTTP 504') fail(err) })
      // the controller drops a pinned node whenever it tests the group, even when the test fails
      if (group.fixed) await select(group.name, group.fixed)
    } catch (err) {
      fail(err)
    } finally {
      await load()
      setTesting(null)
    }
  }

  const openGroup = (name: string) => {
    setActionError(null)
    setQuery('')
    setOpenName(name)
    setDrawerOpen(true)
  }

  const current = openName ? proxies?.[openName] : undefined
  const needle = query.trim().toLowerCase()
  const options = (current?.all ?? [])
    .filter(name => !needle || name.toLowerCase().includes(needle))
    .map(name => ({
      value: name,
      label: name,
      description: proxies?.[name]?.type,
      meta: <Delay value={current && proxies ? lastDelay(proxies, name, testUrl(current)) : undefined} />,
    }))

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('策略组', 'Proxy groups')}</h1>
          <p className={styles.sub}>{t('切换节点后，该策略组的现有连接会断开并重连。', 'Switching a node closes the connections in that group so they reconnect through it.')}</p>
        </div>
      </header>
      {loadError && <Alert tone="danger" title={t('读取失败', 'Could not load')}>{loadError}</Alert>}
      {!drawerOpen && actionError && <Alert tone="danger" title={t('操作失败', 'That did not work')}>{actionError}</Alert>}
      <section className={styles.card} aria-busy={running && !proxies}>
        {!running
          ? <EmptyState title={t('内核未运行', 'Core is stopped')} description={t('启动 RouterClash 后可以在这里选择节点。', 'Start RouterClash to choose nodes here.')} />
          : !proxies
            ? <Skeleton lines={5} />
            : groups.length === 0
              ? <EmptyState title={t('没有策略组', 'No proxy groups')} description={t('当前配置没有定义策略组。', 'The current config defines no proxy groups.')} />
              : groups.map(group => (
                  <div key={group.name} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowName}>{group.name}</span>
                      <span className={styles.rowMeta}>{typeLabels[group.type] ?? group.type} · {group.now ?? t('未选择', 'None')} · {t(`${group.all?.length ?? 0} 个节点`, `${group.all?.length ?? 0} nodes`)}</span>
                    </div>
                    <div className={styles.actions}>
                      {group.fixed && <Badge>{t('已固定', 'Pinned')}</Badge>}
                      <Delay value={lastDelay(proxies, group.name, testUrl(group))} />
                      <Button size="sm" variant="ghost" loading={testing === group.name} onClick={() => void test(group)}>{t('测速', 'Test')}</Button>
                      <Button size="sm" variant="secondary" onClick={() => openGroup(group.name)}>{canChoose(group) ? t('选择节点', 'Choose node') : t('查看节点', 'View nodes')}</Button>
                    </div>
                  </div>
                ))}
      </section>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        {current && (
          <DrawerContent title={current.name} description={canChoose(current) ? t('选择这个策略组使用的节点。', 'Choose the node this group uses.') : t('负载均衡组会自动分配节点。', 'Load balance groups spread traffic across nodes on their own.')}>
            <div className={styles.stack}>
              {actionError && <Alert tone="danger" title={t('操作失败', 'That did not work')}>{actionError}</Alert>}
              {current.fixed && (
                <div className={styles.spread}>
                  <span className={styles.hint}>{t(`已固定到 ${current.fixed}`, `Pinned to ${current.fixed}`)}</span>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void unpin(current)}>{t('恢复自动选择', 'Return to automatic')}</Button>
                </div>
              )}
              <div className={styles.spread}>
                <div className={styles.grow}><SearchField label={t('搜索节点', 'Search nodes')} value={query} onValueChange={setQuery} /></div>
                <Button size="sm" variant="ghost" loading={testing === current.name} onClick={() => void test(current)}>{t('测速', 'Test')}</Button>
              </div>
              {options.length === 0
                ? <EmptyState title={t('没有匹配的节点', 'No matching nodes')} description={t('换个关键词试试。', 'Try another keyword.')} />
                : <RadioCards aria-label={t('节点', 'Nodes')} layout="list" value={current.now ?? null} disabled={!canChoose(current) || busy} onValueChange={node => void choose(current, node)} options={options} />}
            </div>
          </DrawerContent>
        )}
      </Drawer>
    </main>
  )
}
