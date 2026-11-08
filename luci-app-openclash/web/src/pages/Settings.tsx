import { useEffect, useMemo, useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { Select } from '@/components/arc/select/select'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { Switch } from '@/components/arc/switch/switch'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import schema from '@/generated/settings-schema.json'
import { apiGet, apiPost, service } from '@/lib/api'
import { pick, t } from '@/lib/i18n'
import styles from './layout.module.css'

type Field = {
  key: string; tab: string; type: string; title: string; titleEn: string
  desc?: string; descEn?: string; placeholder?: string; default?: string
  values: string[][]; depends: string[][]
}
type Values = Record<string, string | string[]>

const fields = schema.fields as Field[]
const groups = schema.groups as string[][]

function visible(field: Field, values: Values) {
  if (!field.depends.length) return true
  // CBI depends: any listed pair may match, a pair matches on the current or default value
  return field.depends.some(([key, want]) => {
    const peer = fields.find(item => item.key === key)
    return String(values[key] ?? peer?.default ?? '') === want
  })
}

function FieldControl({ field, value, onChange }: { field: Field; value: string | string[] | undefined; onChange: (value: string | string[]) => void }) {
  const label = pick(field.title, field.titleEn)
  const description = pick(field.desc, field.descEn)
  const current = value ?? field.default ?? ''
  if (field.type === 'Flag') {
    return (
      <div className={styles.field}>
        <div className={styles.fieldHead}>
          <span className={styles.fieldLabel}>{label}</span>
          <Switch aria-label={label} checked={current === '1'} onCheckedChange={checked => onChange(checked ? '1' : '0')} />
        </div>
        {description && <p className={styles.fieldDesc}>{description}</p>}
      </div>
    )
  }
  if (field.type === 'ListValue' && field.values.length) {
    return <Select label={label} description={description || undefined} value={String(current)} onValueChange={next => onChange(next)} options={field.values.map(([v, zh, en]) => ({ value: v, label: pick(zh, en) }))} />
  }
  if (field.type === 'DynamicList') {
    const list = Array.isArray(current) ? current : current ? [current] : []
    return (
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={field.key}>{label}</label>
        <textarea id={field.key} className={styles.textarea} value={list.join('\n')} placeholder={t('每行一项', 'One entry per line')} onChange={event => onChange(event.target.value.split('\n'))} />
        {description && <p className={styles.fieldDesc}>{description}</p>}
      </div>
    )
  }
  return <Input label={label} description={description || undefined} type={field.type === 'Password' ? 'password' : 'text'} autoComplete="off" placeholder={field.placeholder} value={String(current)} onChange={event => onChange(event.target.value)} />
}

export function Settings() {
  const [values, setValues] = useState<Values | null>(null)
  const [changed, setChanged] = useState<Values>({})
  const [group, setGroup] = useState(groups[0][0])
  const [state, setState] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [saving, setSaving] = useState<'save' | 'apply' | null>(null)

  useEffect(() => {
    apiGet<{ values: Values }>('settings_get').then(data => setValues(data.values)).catch(err => setState({ tone: 'danger', text: (err as Error).message }))
  }, [])

  const merged = useMemo(() => ({ ...values, ...changed }), [values, changed])
  const shown = fields.filter(field => field.tab === group && visible(field, merged))
  const dirty = Object.keys(changed).length > 0

  const save = async (apply: boolean) => {
    setSaving(apply ? 'apply' : 'save')
    setState(null)
    try {
      const clean = Object.fromEntries(Object.entries(changed).map(([key, value]) => [key, Array.isArray(value) ? value.map(item => item.trim()).filter(Boolean) : value]))
      await apiPost('settings_set', { values: JSON.stringify(clean) })
      setValues(current => ({ ...current, ...clean }))
      setChanged({})
      if (apply) await service('restart')
      setState({ tone: 'success', text: apply ? t('已保存，正在重启', 'Saved. Restarting now.') : t('已保存，重启后生效', 'Saved. Restart to apply.') })
    } catch (err) {
      setState({ tone: 'danger', text: (err as Error).message })
    } finally {
      setSaving(null)
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('设置', 'Settings')}</h1>
        <div className={styles.tools}>
          <Button variant="secondary" disabled={!dirty} loading={saving === 'save'} onClick={() => save(false)}>{t('保存', 'Save')}</Button>
          <Button disabled={!dirty} loading={saving === 'apply'} onClick={() => save(true)}>{t('保存并重启', 'Save and restart')}</Button>
        </div>
      </header>
      {state && <Alert tone={state.tone} title={state.text} />}
      <div className={styles.tableScroll}>
        <SegmentedControl label={t('设置分组', 'Settings group')} value={group} onValueChange={setGroup} options={groups.map(([value, zh, en]) => ({ value, label: pick(zh, en) }))} />
      </div>
      <section className={styles.card} aria-busy={!values}>
        {!values ? <Skeleton lines={8} /> : shown.map(field => <FieldControl key={field.key} field={field} value={merged[field.key]} onChange={value => setChanged(current => ({ ...current, [field.key]: value }))} />)}
      </section>
    </main>
  )
}
