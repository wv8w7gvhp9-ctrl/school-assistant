import type { ChildTab } from '../domain/types'
import type { ReactNode } from 'react'

type IconName = ChildTab | 'profile' | 'star' | 'clock' | 'backpack' | 'chevron' | 'check'

const paths: Record<IconName, ReactNode> = {
  today: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  schedule: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  homework: <><path d="M7 3h8l3 3v15H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M9 11h6M9 15h5M15 3v4h4" /></>,
  books: <><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5v-17Z" /><path d="M5 19a2.5 2.5 0 0 1 2.5-2.5H19M9 6h6" /></>,
  clubs: <><circle cx="8" cy="8" r="3" /><circle cx="17" cy="7" r="2" /><path d="M3 20c.6-4 2.3-6 5-6s4.4 2 5 6M14 20c.3-2.4 1.3-3.8 3-3.8 1.3 0 2.4.8 3 2.5" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></>,
  star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  backpack: <><path d="M8 8V6a4 4 0 0 1 8 0v2" /><path d="M6 9h12a2 2 0 0 1 2 2v9H4v-9a2 2 0 0 1 2-2Z" /><path d="M4 15h16M9 15v2h6v-2" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
}

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return <svg aria-hidden={label ? undefined : true} aria-label={label} className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
