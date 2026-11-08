import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { app, apiGet, apiPost, apiUpload } from '@/lib/api'
import { t } from '@/lib/i18n'
import styles from './layout.module.css'

type Info = { coremetacv?: string; corever?: string; release_branch?: string; opcv?: string }

export function Update() {
  const [info, setInfo] = useState<Info>({})
  const [latest, setLatest] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const restore = useRef<HTMLInputElement>(null)
  const load = useCallback(() => {
    apiGet<Info>('update').then(setInfo).catch(() => undefined)
    apiGet<{ corelv?: string }>('last_version').then(data => setLatest((data.corelv ?? '').split(',')[0])).catch(() => undefined)
  }, [])
  useEffect(load, [load])

  const update = () => {
    setBusy(true)
    setNote(null)
    apiPost('coreupdate').then(() => setNote({ tone: 'success', text: t('已开始更新内核，完成后只重启内核进程，进度见日志', 'Core update started. Only the core process restarts. See Logs for progress.') }))
      .catch(err => setNote({ tone: 'danger', text: (err as Error).message })).finally(() => setBusy(false))
  }

  const onRestore = (file?: File) => {
    if (!file) return
    const form = new FormData()
    form.append('backup_file', file, file.name)
    apiUpload('restore_backup', form).then(() => setNote({ tone: 'success', text: t('已恢复备份', 'Backup restored') })).catch(err => setNote({ tone: 'danger', text: (err as Error).message }))
  }

  const current = info.coremetacv || t('未安装', 'Not installed')
  return (
    <main className={styles.page}>
      <header className={styles.header}><h1 className={styles.title}>{t('更新与备份', 'Update and backup')}</h1></header>
      {note && <Alert tone={note.tone} title={note.text} />}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{t('Meta 内核', 'Meta core')}</h2>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowName}>{current}</span>
            <span className={styles.rowMeta}>{latest ? t(`最新版本：${latest}`, `Latest: ${latest}`) : t('正在检查最新版本', 'Checking the latest version')}</span>
          </div>
          <Button loading={busy} onClick={update}>{t('更新内核', 'Update core')}</Button>
        </div>
        <p className={styles.hint}>{t(`插件版本 ${info.opcv ?? app.version}。这是个人精简版，插件本身不再在线更新。`, `Plugin ${info.opcv ?? app.version}. This is a personal build without online plugin updates.`)}</p>
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{t('备份', 'Backup')}</h2>
        <div className={styles.actions}>
          <input ref={restore} type="file" accept=".gz,.tgz" hidden onChange={event => { onRestore(event.target.files?.[0]); event.target.value = '' }} />
          <Button variant="secondary" onClick={() => { location.href = `${app.base}/backup_ex_core` }}>{t('下载备份', 'Download backup')}</Button>
          <Button variant="secondary" onClick={() => restore.current?.click()}>{t('恢复备份', 'Restore backup')}</Button>
        </div>
        <p className={styles.hint}>{t('备份不包含内核文件。', 'The backup does not include the core binary.')}</p>
      </section>
    </main>
  )
}
