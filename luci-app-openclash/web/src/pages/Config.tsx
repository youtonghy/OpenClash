import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Input } from '@/components/arc/input/input'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { apiGet, apiPost, apiUpload, bytes, type ConfigFile } from '@/lib/api'
import { Editor } from '@/lib/Editor'
import { t } from '@/lib/i18n'
import styles from './layout.module.css'

type Listing = { config_files: ConfigFile[]; current_config: string }
type Note = { tone: 'success' | 'danger'; text: string } | null

export function Config() {
  const [list, setList] = useState<Listing | null>(null)
  const [note, setNote] = useState<Note>(null)
  const [editing, setEditing] = useState<{ path: string; name: string; content: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [sub, setSub] = useState({ name: '', address: '' })
  const upload = useRef<HTMLInputElement>(null)

  const fail = (err: unknown) => setNote({ tone: 'danger', text: (err as Error).message })
  const load = useCallback(() => {
    apiGet<Listing>('config_file_list').then(setList).catch(fail)
  }, [])
  useEffect(load, [load])

  const open = (file: ConfigFile) => {
    setNote(null)
    apiGet<string>('config_file_read', { config_file: file.path })
      .then(content => setEditing({ path: file.path, name: file.name, content: typeof content === 'string' ? content : JSON.stringify(content) }))
      .catch(fail)
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const form = new FormData()
      form.append('content', new Blob([editing.content.replace(/\r\n?/g, '\n')], { type: 'text/plain' }), editing.name)
      await apiUpload('config_file_save', form, { config_file: editing.path })
      setNote({ tone: 'success', text: t('已保存，重启后生效', 'Saved. Restart to apply.') })
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  const action = (work: Promise<unknown>, done: string) => {
    setNote(null)
    work.then(() => {
      setNote({ tone: 'success', text: done })
      load()
    }).catch(fail)
  }

  const onUpload = (file?: File) => {
    if (!file) return
    const form = new FormData()
    form.append('config_file', file, file.name)
    action(apiUpload('upload_config', form), t('已上传', 'Uploaded'))
  }

  const addSubscription = () => {
    setAdding(false)
    action(apiPost('add_subscription', { name: sub.name, address: sub.address, sub_convert: '0' }), t('已添加订阅', 'Subscription added'))
    setSub({ name: '', address: '' })
  }

  if (editing) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>{editing.name}</h1>
          <div className={styles.tools}>
            <Button variant="secondary" onClick={() => setEditing(null)}>{t('返回', 'Back')}</Button>
            <Button loading={saving} onClick={save}>{t('保存', 'Save')}</Button>
          </div>
        </header>
        {note && <Alert tone={note.tone} title={note.text} />}
        <div className={styles.editor}><Editor key={editing.path} label={editing.name} value={editing.content} onChange={content => setEditing(current => current && { ...current, content })} /></div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('配置文件', 'Config files')}</h1>
        <div className={styles.tools}>
          <input ref={upload} type="file" accept=".yaml,.yml" hidden onChange={event => { onUpload(event.target.files?.[0]); event.target.value = '' }} />
          <Button variant="secondary" onClick={() => setAdding(true)}>{t('添加订阅', 'Add subscription')}</Button>
          <Button onClick={() => upload.current?.click()}>{t('上传配置', 'Upload config')}</Button>
        </div>
      </header>
      {note && <Alert tone={note.tone} title={note.text} />}
      <section className={styles.card} aria-busy={!list}>
        {!list ? <Skeleton lines={5} /> : list.config_files.length === 0
          ? <EmptyState title={t('还没有配置文件', 'No config files yet')} description={t('上传一个 YAML 配置或添加订阅。', 'Upload a YAML config or add a subscription.')} />
          : list.config_files.map(file => {
              const current = file.path === list.current_config
              return (
                <div key={file.path} className={styles.row}>
                  <div className={styles.rowMain}>
                    <span className={styles.rowName}>{file.name}</span>
                    <span className={styles.rowMeta}>{bytes(file.size)} · {new Date(file.mtime * 1000).toLocaleString()}</span>
                  </div>
                  <div className={styles.actions}>
                    {current && <Badge tone="success" dot>{t('使用中', 'In use')}</Badge>}
                    <Button size="sm" variant="secondary" onClick={() => open(file)}>{t('编辑', 'Edit')}</Button>
                    {!current && <Button size="sm" variant="secondary" onClick={() => action(apiPost('switch_config', { config_file: file.path }), t('已切换，正在重启', 'Switched. Restarting.'))}>{t('切换', 'Use')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => action(apiPost('update_config', { filename: file.name }), t('已开始更新', 'Update started'))}>{t('更新', 'Update')}</Button>
                  </div>
                </div>
              )
            })}
      </section>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title={t('添加订阅', 'Add subscription')} description={t('按地址下载完整的 YAML 配置。', 'Downloads a complete YAML config from a URL.')}>
          <div className={styles.field}>
            <Input label={t('名称', 'Name')} value={sub.name} onChange={event => setSub(s => ({ ...s, name: event.target.value }))} />
            <Input label={t('订阅地址', 'URL')} value={sub.address} onChange={event => setSub(s => ({ ...s, address: event.target.value }))} />
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setAdding(false)}>{t('取消', 'Cancel')}</Button>
              <Button disabled={!sub.name || !/^https?:\/\//.test(sub.address)} onClick={addSubscription}>{t('添加', 'Add')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
