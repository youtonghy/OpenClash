import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { apiGet, apiPost, apiUpload, bytes, type ConfigFile } from '@/lib/api'
import { Editor } from '@/lib/Editor'
import { t } from '@/lib/i18n'
import styles from './layout.module.css'

export function Overwrite() {
  const [files, setFiles] = useState<ConfigFile[] | null>(null)
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [editing, setEditing] = useState<{ path: string; name: string; content: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const fail = (err: unknown) => setNote({ tone: 'danger', text: (err as Error).message })
  const load = useCallback(() => {
    apiGet<{ overwrite_files: ConfigFile[] }>('overwrite_file_list').then(data => setFiles(data.overwrite_files)).catch(fail)
  }, [])
  useEffect(load, [load])

  const open = (file: ConfigFile) => {
    apiGet<string>('config_file_read', { config_file: file.path })
      .then(content => setEditing({ path: file.path, name: file.name, content: String(content) }))
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
  const onUpload = (file?: File) => {
    if (!file) return
    const form = new FormData()
    form.append('config_file', file, file.name)
    apiUpload('upload_overwrite', form, { enable: '1' }).then(load).catch(fail)
  }
  const remove = (file: ConfigFile) => {
    apiPost('delete_overwrite_file', { filename: file.name }).then(load).catch(fail)
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
        <div className={styles.editor}><Editor key={editing.path} label={editing.name} yaml={false} value={editing.content} onChange={content => setEditing(current => current && { ...current, content })} /></div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('覆写模块', 'Overwrite modules')}</h1>
          <p className={styles.sub}>{t('启动时按顺序叠加到配置上，文件名以 default 开头的模块随插件更新。', 'Applied on top of the config at start, in order.')}</p>
        </div>
        <div className={styles.tools}>
          <input ref={upload} type="file" hidden onChange={event => { onUpload(event.target.files?.[0]); event.target.value = '' }} />
          <Button onClick={() => upload.current?.click()}>{t('上传模块', 'Upload module')}</Button>
        </div>
      </header>
      {note && <Alert tone={note.tone} title={note.text} />}
      <section className={styles.card} aria-busy={!files}>
        {!files ? <Skeleton lines={5} /> : files.length === 0
          ? <EmptyState title={t('还没有覆写模块', 'No modules yet')} description={t('上传一个模块文件开始使用。', 'Upload a module file to get started.')} />
          : files.map(file => (
              <div key={file.path} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowName}>{file.name}</span>
                  <span className={styles.rowMeta}>{bytes(file.size)} · {new Date(file.mtime * 1000).toLocaleString()}</span>
                </div>
                <div className={styles.actions}>
                  <Button size="sm" variant="secondary" onClick={() => open(file)}>{t('编辑', 'Edit')}</Button>
                  {file.name !== 'default' && <Button size="sm" variant="ghost" onClick={() => remove(file)}>{t('删除', 'Delete')}</Button>}
                </div>
              </div>
            ))}
      </section>
    </main>
  )
}
