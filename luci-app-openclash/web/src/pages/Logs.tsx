import { useState } from 'react'
import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { apiGet, apiPost } from '@/lib/api'
import { t } from '@/lib/i18n'
import { usePolling } from '@/lib/mihomo'
import styles from './layout.module.css'

type Log = { core_log?: string; oc_log?: string; update?: boolean }

export function Logs() {
  const [kind, setKind] = useState<'oc' | 'core'>('oc')
  const [log, setLog] = useState<Log>({})
  const load = () => apiGet<Log>('refresh_log', { log_len: '0', core_refresh: 'true' }).then(data => { if (data.update !== false) setLog(data) }).catch(() => undefined)
  usePolling(() => void load(), 5000)
  const text = (kind === 'oc' ? log.oc_log : log.core_log) ?? ''
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('日志', 'Logs')}</h1>
        <div className={styles.tools}>
          <SegmentedControl label={t('日志类型', 'Log type')} value={kind} onValueChange={value => setKind(value as 'oc' | 'core')} options={[{ value: 'oc', label: t('插件', 'Plugin') }, { value: 'core', label: t('内核', 'Core') }]} />
          <Button variant="secondary" onClick={() => apiPost('del_log', { type: kind === 'oc' ? 'oclog' : 'corelog' }).then(() => load())}>{t('清空', 'Clear')}</Button>
        </div>
      </header>
      <section className={styles.card}><pre className={styles.log}>{text || t('暂无日志', 'No log entries')}</pre></section>
    </main>
  )
}
