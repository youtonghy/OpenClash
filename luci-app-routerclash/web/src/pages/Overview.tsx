import { useMemo, useRef, useState } from 'react'
import { Play, RotateCw, Square } from 'lucide-react'
import { Button } from '@/components/arc/button/button'
import { Badge } from '@/components/arc/badge/badge'
import { Alert } from '@/components/arc/alert/alert'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog'
import { MorphSelect } from '@/components/arc/morph-select/morph-select'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { MetricTicker, type TickerMetric } from '@/components/arc/metric-ticker/metric-ticker'
import { RealtimeStream, type StreamPoint } from '@/components/arc/realtime-stream/realtime-stream'
import { IconButton } from '@/components/IconButton'
import { apiGet, apiPost, bytes, isRunning, service, type Status } from '@/lib/api'
import { locale, t } from '@/lib/i18n'
import { useMihomoStream, usePolling, type Snapshot } from '@/lib/mihomo'
import styles from './layout.module.css'

type Traffic = { up: number; down: number }
type Memory = { inuse: number }
type Load = { cpu: string }

const WINDOW = 90
const CHART_MS = 60000
const REFRESH_KEY = 'routerclash.overview.refresh'
/** Measuring core CPU blocks a LuCI request for 200 ms, so it is never polled faster than this. */
const CPU_POLL_MS = 5000
const HISTORY = 24
// download, upload, connections, memory, cpu, total: wide enough for the largest realistic reading
const TICKER_COLUMNS = 'minmax(128px, 1.1fr) minmax(128px, 1.1fr) minmax(136px, 1fr) minmax(184px, 1.4fr) minmax(140px, 1fr) minmax(120px, .9fr)'

const fixed = (digits: number): Intl.NumberFormatOptions => ({ minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })

/** Moves to a larger unit before a number reaches four integer digits, so a reading never outgrows its slot. */
function scale(value: number, units: string[]) {
  let index = 0
  let divisor = 1
  while (value / divisor >= 1024 && index < units.length - 1) {
    divisor *= 1024
    index += 1
  }
  return { value: value / divisor, unit: units[index], divisor }
}

const RATE_UNITS = ['kilobyte-per-second', 'megabyte-per-second', 'gigabyte-per-second']

function rateMetric(id: string, label: string, kilobytes: number, points: StreamPoint[]): TickerMetric {
  const shown = scale(kilobytes, RATE_UNITS)
  return { id, label, value: shown.value, delta: 'none', format: { ...fixed(1), style: 'unit', unit: shown.unit }, history: points.slice(-HISTORY).map(point => point.value / shown.divisor) }
}

export function Overview({ status, refresh }: { status?: Status; refresh: () => void }) {
  const running = isRunning(status)
  const [down, setDown] = useState<StreamPoint[]>([])
  const [up, setUp] = useState<StreamPoint[]>([])
  const [seconds, setSeconds] = useState(() => (localStorage.getItem(REFRESH_KEY) === '5' ? 5 : 1))
  const [live, setLive] = useState({ up: 0, down: 0, memory: 0, cpu: 0, totalDown: 0, totalUp: 0, connections: 0 })
  // Streams only write here; one publish per interval moves every reading together.
  const pending = useRef({ up: 0, down: 0, samples: 0, publishes: 0, memory: 0, cpu: 0, totalDown: 0, totalUp: 0, connections: 0 })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)

  useMihomoStream<Traffic>(status, '/traffic', running, data => {
    const next = pending.current
    next.up += data.up
    next.down += data.down
    next.samples += 1
    // the first two publish at once, so a 5 second interval does not start with five seconds of zeros
    if (next.samples < (next.publishes < 2 ? 1 : seconds)) return
    const now = Date.now()
    const up = next.up / next.samples / 1024
    const down = next.down / next.samples / 1024
    next.up = next.down = next.samples = 0
    next.publishes += 1
    setLive({ up, down, memory: next.memory, cpu: next.cpu, totalDown: next.totalDown, totalUp: next.totalUp, connections: next.connections })
    setDown(list => [...list.slice(-WINDOW), { t: now, value: down }])
    setUp(list => [...list.slice(-WINDOW), { t: now, value: up }])
  })
  useMihomoStream<Memory>(status, '/memory', running, data => {
    if (data.inuse) pending.current.memory = data.inuse
  })
  useMihomoStream<Snapshot>(status, `/connections?interval=${seconds * 1000}`, running, data => {
    Object.assign(pending.current, { totalDown: data.downloadTotal, totalUp: data.uploadTotal, connections: data.connections?.length ?? 0 })
  })
  usePolling(() => {
    void apiGet<Load>('toolbar_show_sys').then(data => { pending.current.cpu = Number(data.cpu) || 0 }).catch(() => undefined)
  }, CPU_POLL_MS, running)

  const metrics = useMemo<TickerMetric[]>(() => {
    const total = scale(live.totalDown / 1073741824, ['gigabyte', 'terabyte'])
    return [
      rateMetric('down', t('下载', 'Download'), live.down, down),
      rateMetric('up', t('上传', 'Upload'), live.up, up),
      { id: 'conn', label: t('活动连接', 'Connections'), value: live.connections, format: { useGrouping: false } },
      { id: 'mem', label: t('内核内存', 'Core memory'), value: live.memory / 1048576, format: { ...fixed(1), style: 'unit', unit: 'megabyte' }, positive: 'down', delta: 'absolute' },
      { id: 'cpu', label: t('内核 CPU', 'Core CPU'), value: live.cpu, format: { ...fixed(1), style: 'unit', unit: 'percent' }, positive: 'down', delta: 'absolute' },
      { id: 'total', label: t('累计下载', 'Total download'), value: total.value, format: { ...fixed(2), style: 'unit', unit: total.unit }, delta: 'none' },
    ]
  }, [live, down, up])

  const changeSeconds = (value: string) => {
    localStorage.setItem(REFRESH_KEY, value)
    setSeconds(Number(value))
  }

  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const ruleModes = [
    { value: 'rule', label: t('规则', 'Rule') },
    { value: 'global', label: t('全局', 'Global') },
    { value: 'direct', label: t('直连', 'Direct') },
  ]

  if (!status) return <main className={styles.page}><Skeleton lines={8} /></main>

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('概览', 'Overview')}</h1>
          <p className={styles.sub}>{status.run_mode ? t(`运行模式：${status.run_mode}`, `Mode: ${status.run_mode}`) : t('服务未运行', 'Service is stopped')}</p>
        </div>
        <div className={styles.tools}>
          {running && (
            <MorphSelect
              label={t('刷新间隔', 'Refresh interval')}
              hideLabel
              align="end"
              searchable={false}
              panelWidth={180}
              value={String(seconds)}
              items={[{ value: '1', label: t('每 1 秒刷新', 'Every 1s') }, { value: '5', label: t('每 5 秒刷新', 'Every 5s') }]}
              onValueChange={changeSeconds}
            />
          )}
          <div className={styles.actions}>
            {running
              ? <>
                  <IconButton variant="secondary" label={t('重启', 'Restart')} icon={<RotateCw />} loading={busy === 'restart'} onClick={() => run('restart', () => service('restart'))} />
                  <IconButton variant="secondary" label={t('停止', 'Stop')} icon={<Square />} onClick={() => setConfirmStop(true)} />
                </>
              : <IconButton label={t('启动', 'Start')} icon={<Play />} loading={busy === 'start'} onClick={() => run('start', () => service('start'))} />}
          </div>
          <Badge tone={running ? 'success' : 'neutral'} dot>{running ? t('运行中', 'Running') : t('已停止', 'Stopped')}</Badge>
        </div>
      </header>

      {error && <Alert tone="danger" title={t('操作失败', 'Action failed')}>{error}</Alert>}

      {status.kill_switch_state === 'blocked' && (
        <Alert tone="danger" title={t('断网保护已生效', 'Kill switch is active')}>
          <p className={styles.hint}>{t('RouterClash 没有运行，局域网设备已暂时不能访问外网，防止流量绕过代理。', 'RouterClash is not running, so LAN devices cannot reach the internet. This keeps traffic from bypassing the proxy.')}</p>
          <div className={styles.actions}>
            <Button size="sm" loading={busy === 'start'} onClick={() => run('start', () => service('restart'))}>{t('重新启动', 'Start again')}</Button>
            <Button size="sm" variant="secondary" loading={busy === 'bypass'} onClick={() => run('bypass', () => apiPost('kill_switch_action', { action: 'bypass' }))}>{t('临时放行', 'Allow direct access for now')}</Button>
          </div>
        </Alert>
      )}
      {status.kill_switch_state === 'bypass' && (
        <Alert tone="warning" title={t('断网保护已临时放行', 'Kill switch is bypassed')}>
          <p className={styles.hint}>{t('局域网设备现在可能直连外网。RouterClash 成功启动后会自动恢复保护。', 'LAN devices may reach the internet directly. Protection returns when RouterClash starts.')}</p>
          <div className={styles.actions}>
            <Button size="sm" variant="secondary" loading={busy === 'resume'} onClick={() => run('resume', () => apiPost('kill_switch_action', { action: 'resume' }))}>{t('恢复保护', 'Turn protection back on')}</Button>
          </div>
        </Alert>
      )}

      <MetricTicker metrics={metrics} locale={locale} label={t('实时指标', 'Live metrics')} overflow="scroll" columns={TICKER_COLUMNS} />

      <section className={styles.two} aria-label={t('实时流量', 'Live traffic')}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>{t('下载', 'Download')}</h2>
          <RealtimeStream points={down} label={t('下载速率', 'Download rate')} unit="KB/s" min={0} windowMs={CHART_MS} interval={seconds * 1000} emptyLabel={running ? t('等待数据', 'Waiting for data') : t('内核未运行', 'Core is stopped')} />
        </div>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>{t('上传', 'Upload')}</h2>
          <RealtimeStream points={up} label={t('上传速率', 'Upload rate')} unit="KB/s" min={0} windowMs={CHART_MS} interval={seconds * 1000} emptyLabel={running ? t('等待数据', 'Waiting for data') : t('内核未运行', 'Core is stopped')} />
        </div>
      </section>

      <section className={styles.card} aria-label={t('代理模式', 'Proxy mode')}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>{t('代理模式', 'Proxy mode')}</h2>
            <p className={styles.hint}>{t(`累计上传 ${bytes(live.totalUp)}，累计下载 ${bytes(live.totalDown)}`, `Uploaded ${bytes(live.totalUp)}, downloaded ${bytes(live.totalDown)}`)}</p>
          </div>
          <SegmentedControl label={t('代理模式', 'Proxy mode')} options={ruleModes} value={status.rule_mode ?? 'rule'} onValueChange={value => run('mode', () => apiPost('switch_rule_mode', { rule_mode: value }))} />
        </div>
      </section>

      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent title={t('停止 RouterClash？', 'Stop RouterClash?')} description={t('停止后局域网设备将不再经过代理。', 'Devices on your network will stop using the proxy.')}>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setConfirmStop(false)}>{t('取消', 'Cancel')}</Button>
            <Button loading={busy === 'stop'} onClick={() => { setConfirmStop(false); void run('stop', () => service('stop')) }}>{t('停止', 'Stop')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
