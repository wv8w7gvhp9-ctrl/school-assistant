import type { HomeworkStatus } from '../domain/types'
import { Icon } from './Icon'

const labels: Record<HomeworkStatus, string> = {
  todo: 'Нужно выполнить',
  pending_review: 'Ждёт проверки',
  approved: 'Подтверждено',
  needs_revision: 'Нужно доделать',
}

export function StatusChip({ status }: { status: HomeworkStatus }) {
  const icon = status === 'approved' ? 'check' : status === 'todo' || status === 'needs_revision' ? 'clock' : 'clock'
  return <span className={`status-chip ${status}`}><Icon name={icon} />{labels[status]}</span>
}

export function StarCounter({ value }: { value: number }) {
  return <div className="star-counter" aria-label={`Звёздочек: ${value}`}><Icon name="star" /><strong>{value}</strong></div>
}

export function SectionTitle({ children, action }: { children: string; action?: string }) {
  return <div className="section-title"><h2>{children}</h2>{action && <button type="button" className="text-button">{action}<Icon name="chevron" /></button>}</div>
}
