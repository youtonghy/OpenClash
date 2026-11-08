import { useMemo, useState } from 'react'
import { Button } from '@/components/arc/button/button'
import { Badge } from '@/components/arc/badge/badge'
import { Alert } from '@/components/arc/alert/alert'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { MetricTicker, type TickerMetric } from '@/components/arc/metric-ticker/metric-ticker'
import { RealtimeStream, type StreamPoint } from '@/components/arc/realtime-stream/realtime-stream'
import { apiGet, apiPost, bytes, isRunning, service, type Status } from '@/lib/api'
import { locale, t } from '@/lib/i18n'
import { useMihomoStream, usePolling, type Snapshot } from '@/lib/mihomo'
import styles from './layout.module.css'

type Traffic = { up: number; down: number }
type Memory = { inuse: number }
type Load = { cpu: string }

const WINDOW = 90

export function Overview({ status, refresh }: { status?: Status; refresh: () => void }) {
  const running = isRunning(status)
  const [down, setDown] = useState<StreamPoint[]>([])
  const [up, setUp] = useState<StreamPoint[]>([])
  const [rate, setRate] = useState<Traffic>({ up: 0, down: 0 })
  const [memory, setMemory] = useState(0)
  const [totals, setTotals] = useState({ down: 0, up: 0, connections: 0 })
  const [cpu, setCpu] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)

  useMihomoStream<Traffic>(status, '/traffic', running, data => {
    const now = Date.now()
    setRate(data)
    setDown(list => [...list.slice(-WINDOW), { t: now, value: data.down / 1024 }])
    setUp(list => [...list.slice(-WINDOW), { t: now, value: data.up / 1024 }])
  })
  useMihomoStream<Memory>(status, '/memory', running, data => {
    if (data.inuse) setMemory(data.inuse)
  })
  useMihomoStream<Snapshot>(status, '/connections?interval=3000', running, data => {
    setTotals({ down: data.downloadTotal, up: data.uploadTotal, connections: data.connections?.length ?? 0 })
  })
  usePolling(() => {
    void apiGet<Load>('toolbar_show_sys').then(data => setCpu(Number(data.cpu) || 0)).catch(() => undefined)
  }, 15000, running)

  const metrics = useMemo<TickerMetric[]>(() => [
    { id: 'down', label: t('下载', 'Download'), value: rate.down / 1024, format: { maximumFractionDigits: 0, style: 'unit', unit: 'kilobyte-per-second' } },
    { id: 'up', label: t('上传', 'Upload'), value: rate.up / 1024, format: { maximumFractionDigits: 0, style: 'unit', unit: 'kilobyte-per-second' } },
    { id: 'conn', label: t('活动连接', 'Connections'), value: totals.connections },
    { id: 'mem', label: t('内核内存', 'Core memory'), value: memory / 1048576, format: { maximumFractionDigits: 1, style: 'unit', unit: 'megabyte' }, positive: 'down', delta: 'absolute' },
    { id: 'cpu', label: t('内核 CPU', 'Core CPU'), value: cpu, format: { maximumFractionDigits: 1, style: 'unit', unit: 'percent' }, positive: 'down', delta: 'absolute' },
    { id: 'total', label: t('累计下载', 'Total download'), value: totals.down / 1073741824, format: { maximumFractionDigits: 2, style: 'unit', unit: 'gigabyte' } },
  ], [rate, totals, memory, cpu])

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
          <Badge tone={running ? 'success' : 'neutral'} dot>{running ? t('运行中', 'Running') : t('已停止', 'Stopped')}</Badge>
          {running
            ? <>
                <Button variant="secondary" loading={busy === 'restart'} onClick={() => run('restart', () => service('restart'))}>{t('重启', 'Restart')}</Button>
                <Button variant="secondary" onClick={() => setConfirmStop(true)}>{t('停止', 'Stop')}</Button>
              </>
            : <Button loading={busy === 'start'} onClick={() => run('start', () => service('start'))}>{t('启动', 'Start')}</Button>}
        </div>
      </header>

      {error && <Alert tone="danger" title={t('操作失败', 'Action failed')}>{error}</Alert>}

      <MetricTicker metrics={metrics} locale={locale} label={t('实时指标', 'Live metrics')} overflow="scroll" />

      <section className={styles.two} aria-label={t('实时流量', 'Live traffic')}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>{t('下载', 'Download')}</h2>
          <RealtimeStream points={down} label={t('下载速率', 'Download rate')} unit="KB/s" min={0} windowMs={60000} emptyLabel={running ? t('等待数据', 'Waiting for data') : t('内核未运行', 'Core is stopped')} />
        </div>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>{t('上传', 'Upload')}</h2>
          <RealtimeStream points={up} label={t('上传速率', 'Upload rate')} unit="KB/s" min={0} windowMs={60000} emptyLabel={running ? t('等待数据', 'Waiting for data') : t('内核未运行', 'Core is stopped')} />
        </div>
      </section>

      <section className={styles.card} aria-label={t('代理模式', 'Proxy mode')}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>{t('代理模式', 'Proxy mode')}</h2>
            <p className={styles.hint}>{t(`累计上传 ${bytes(totals.up)}，累计下载 ${bytes(totals.down)}`, `Uploaded ${bytes(totals.up)}, downloaded ${bytes(totals.down)}`)}</p>
          </div>
          <SegmentedControl label={t('代理模式', 'Proxy mode')} options={ruleModes} value={status.rule_mode ?? 'rule'} onValueChange={value => run('mode', () => apiPost('switch_rule_mode', { rule_mode: value }))} />
        </div>
      </section>

      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent title={t('停止 OpenClash？', 'Stop OpenClash?')} description={t('停止后局域网设备将不再经过代理。', 'Devices on your network will stop using the proxy.')}>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setConfirmStop(false)}>{t('取消', 'Cancel')}</Button>
            <Button loading={busy === 'stop'} onClick={() => { setConfirmStop(false); void run('stop', () => service('stop')) }}>{t('停止', 'Stop')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
