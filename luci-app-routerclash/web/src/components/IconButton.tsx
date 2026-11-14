import type { ReactNode } from 'react'
import { Button, type ButtonProps } from '@/components/arc/button/button'
import { ConfirmMorph, type ConfirmMorphProps } from '@/components/arc/confirm-morph/confirm-morph'
import { Tooltip } from '@/components/arc/tooltip/tooltip'
import styles from './IconButton.module.css'

type IconProps = { label: string; icon: ReactNode }

const classes = (...names: (string | undefined)[]) => names.filter(Boolean).join(' ')

/** An icon-only Arc button. The label is its accessible name and its tooltip on hover or keyboard focus. */
export function IconButton({ label, icon, size = 'md', disabled, className, ...props }: IconProps & Omit<ButtonProps, 'children' | 'aria-label'>) {
  return (
    <Tooltip content={label}>
      {/* A disabled button fires no pointer events, so the tooltip hangs off a wrapper that keeps the label reachable by keyboard too. */}
      <span className={styles.anchor} tabIndex={disabled ? 0 : undefined}>
        <Button {...props} size={size} disabled={disabled} aria-label={label} className={classes(styles.icon, styles[size], className)}>{icon}</Button>
      </span>
    </Tooltip>
  )
}

/** ConfirmMorph resting as a single icon. The tooltip lives on the resting face, so the question and result faces never show it. */
export function IconConfirm({ label, icon, className, ...props }: IconProps & Omit<ConfirmMorphProps, 'label' | 'icon'>) {
  return (
    <ConfirmMorph
      {...props}
      className={classes(styles.confirm, className)}
      label={
        <Tooltip content={label}>
          <span className={styles.confirmFace}>{icon}<span className={styles.srOnly}>{label}</span></span>
        </Tooltip>
      }
    />
  )
}
