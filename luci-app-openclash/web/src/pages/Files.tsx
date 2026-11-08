import { useEffect, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { apiGet, apiPost, service } from '@/lib/api'
import { Editor } from '@/lib/Editor'
import { t } from '@/lib/i18n'
import styles from './layout.module.css'

const files = [
  { id: 'hosts', label: 'Hosts', yaml: true },
  { id: 'rules', label: t('规则（前置）', 'Rules (first)'), yaml: true },
  { id: 'rules_2', label: t('规则（后置）', 'Rules (last)'), yaml: true },
  { id: 'sniffer', label: t('流量探测', 'Sniffer'), yaml: true },
  { id: 'local_network', label: t('IPv4 绕过', 'IPv4 bypass'), yaml: false },
  { id: 'local_network6', label: t('IPv6 绕过', 'IPv6 bypass'), yaml: false },
  { id: 'firewall', label: t('防火墙脚本', 'Firewall script'), yaml: false },
]

export function Files() {
  const [id, setId] = useState('hosts')
  const [content, setContent] = useState<string | null>(null)
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [saving, setSaving] = useState<'save' | 'apply' | null>(null)
  const file = files.find(item => item.id === id) ?? files[0]

  useEffect(() => {
    let live = true
    setContent(null)
    setNote(null)
    apiGet<{ content: string }>('custom_file_get', { id }).then(data => { if (live) setContent(data.content) }).catch(err => setNote({ tone: 'danger', text: (err as Error).message }))
    return () => { live = false }
  }, [id])

  const save = async (apply: boolean) => {
    if (content === null) return
    setSaving(apply ? 'apply' : 'save')
    try {
      await apiPost('custom_file_save', { id, content })
      if (apply) await service('restart')
      setNote({ tone: 'success', text: apply ? t('已保存，正在重启', 'Saved. Restarting now.') : t('已保存，重启后生效', 'Saved. Restart to apply.') })
    } catch (err) {
      setNote({ tone: 'danger', text: (err as Error).message })
    } finally {
      setSaving(null)
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('自定义文件', 'Custom files')}</h1>
        <div className={styles.tools}>
          <Button variant="secondary" loading={saving === 'save'} onClick={() => save(false)}>{t('保存', 'Save')}</Button>
          <Button loading={saving === 'apply'} onClick={() => save(true)}>{t('保存并重启', 'Save and restart')}</Button>
        </div>
      </header>
      {note && <Alert tone={note.tone} title={note.text} />}
      <div className={styles.tableScroll}><SegmentedControl label={t('文件', 'File')} value={id} onValueChange={setId} options={files.map(item => ({ value: item.id, label: item.label }))} /></div>
      <div className={styles.editor} aria-busy={content === null}>{content === null ? <Skeleton lines={8} /> : <Editor key={id} label={file.label} yaml={file.yaml} value={content} onChange={setContent} />}</div>
    </main>
  )
}
