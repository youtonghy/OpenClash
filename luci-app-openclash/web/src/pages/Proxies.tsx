import { useCallback, useMemo, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { MorphSelect, type MorphSelectOption } from '@/components/arc/morph-select/morph-select'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { isRunning, type Status } from '@/lib/api'
import { t } from '@/lib/i18n'
import { mihomoFetch, proxyGroups, usePolling, type ProxyMap, type ProxyNode, type Snapshot } from '@/lib/mihomo'
import styles from './layout.module.css'

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

function delayText(value?: number) {
  if (value === undefined) return undefined
  return value === 0 ? t('超时', 'Timed out') : `${value} ms`
}

function Delay({ value }: { value?: number }) {
  if (value === undefined) return null
  return <Badge tone={value === 0 || value >= 800 ? 'danger' : value < 300 ? 'success' : 'warning'}><span className={styles.numeric}>{delayText(value)}</span></Badge>
}

function nodeOptions(proxies: ProxyMap, group: ProxyNode): MorphSelectOption[] {
  return (group.all ?? []).map(name => ({
    value: name,
    label: name,
    meta: delayText(lastDelay(proxies, name, testUrl(group))),
    keywords: proxies[name]?.type,
    disabled: !canChoose(group),
  }))
}

export function Proxies({ status }: { status?: Status }) {
  const running = isRunning(status)
  const [proxies, setProxies] = useState<ProxyMap | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

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

  const groups = useMemo(() => (proxies ? proxyGroups(proxies, status?.rule_mode === 'global') : []), [proxies, status?.rule_mode])

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
    setSwitching(group.name)
    setActionError(null)
    // the dropdown keeps the pick while the switch runs, the reload below corrects it on failure
    setProxies(current => current && { ...current, [group.name]: { ...current[group.name], now: node } })
    try {
      await select(group.name, node)
      await closeGroupConnections(group.name)
    } catch (err) {
      fail(err)
    } finally {
      await load()
      setSwitching(null)
    }
  }

  const unpin = async (group: ProxyNode) => {
    if (!status) return
    setSwitching(group.name)
    setActionError(null)
    try {
      await mihomoFetch(status, path(group.name), { method: 'DELETE' })
    } catch (err) {
      fail(err)
    } finally {
      await load()
      setSwitching(null)
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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('策略组', 'Proxy groups')}</h1>
          <p className={styles.sub}>{t('切换节点后，该策略组的现有连接会断开并重连。', 'Switching a node closes the connections in that group so they reconnect through it.')}</p>
        </div>
      </header>
      {loadError && <Alert tone="danger" title={t('读取失败', 'Could not load')}>{loadError}</Alert>}
      {actionError && <Alert tone="danger" title={t('操作失败', 'That did not work')}>{actionError}</Alert>}
      <section className={styles.card} aria-busy={running && !proxies}>
        {!running
          ? <EmptyState title={t('内核未运行', 'Core is stopped')} description={t('启动 RouterClash 后可以在这里选择节点。', 'Start RouterClash to choose nodes here.')} />
          : !proxies
            ? <Skeleton lines={5} />
            : groups.length === 0
              ? <EmptyState title={t('没有策略组', 'No proxy groups')} description={t('当前配置没有定义策略组。', 'The current config defines no proxy groups.')} />
              : groups.map(group => (
                  <div key={group.name} className={styles.groupRow}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowName}>{group.name}</span>
                      <span className={styles.rowMeta}>{typeLabels[group.type] ?? group.type} · {t(`${group.all?.length ?? 0} 个节点`, `${group.all?.length ?? 0} nodes`)}{group.fixed ? ` · ${t('已固定', 'Pinned')}` : ''}</span>
                    </div>
                    <MorphSelect
                      label={t(`${group.name} 使用的节点`, `Node used by ${group.name}`)}
                      hideLabel
                      value={group.now ?? null}
                      placeholder={t('自动分配', 'Automatic')}
                      searchPlaceholder={t('搜索节点', 'Search nodes')}
                      panelWidth={320}
                      disabled={switching === group.name}
                      items={nodeOptions(proxies, group)}
                      onValueChange={node => void choose(group, node)}
                    />
                    <div><Delay value={lastDelay(proxies, group.name, testUrl(group))} /></div>
                    <div className={styles.groupActions}>
                      {group.fixed && <Button size="sm" variant="ghost" disabled={switching === group.name} onClick={() => void unpin(group)}>{t('恢复自动', 'Use automatic')}</Button>}
                      <Button size="sm" variant="ghost" loading={testing === group.name} disabled={testing !== null && testing !== group.name} onClick={() => void test(group)}>{t('测速', 'Test')}</Button>
                    </div>
                  </div>
                ))}
      </section>
    </main>
  )
}
