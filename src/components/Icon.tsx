import type { ChildTab } from '../domain/types'
import type { ReactNode } from 'react'

type IconName = ChildTab | 'profile' | 'star' | 'clock' | 'sun' | 'backpack' | 'chevron' | 'check' | 'refresh'

const paths: Record<IconName, ReactNode> = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" /></>,
  schedule: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></>,
  homework: <><path d="M7 3h8l3 3v15H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M15 3v4h4M9 12h2M9 16h2M14 15l1.5 1.5L18 13" /></>,
  books: <><path d="M3.5 5.5c2.7-1.2 5.5-1.2 8.5.4v13c-3-1.6-5.8-1.6-8.5-.4v-13Z" /><path d="M20.5 5.5c-2.7-1.2-5.5-1.2-8.5.4v13c3-1.6 5.8-1.6 8.5-.4v-13Z" /><path d="M6.5 9h2.5M15 9h2.5" /></>,
  clubs: <><path d="M9 18h6M10 22h4" /><path d="M8.2 15.4A7 7 0 1 1 15.8 15.4C14.7 16.2 14 17.1 14 18h-4c0-.9-.7-1.8-1.8-2.6Z" /><path d="M12 5v2M7.5 7.2l1.4 1.4M16.5 7.2l-1.4 1.4" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></>,
  star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" /></>,
  backpack: <><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" /><path d="M7 8h10a3 3 0 0 1 3 3v8.5A2.5 2.5 0 0 1 17.5 22h-11A2.5 2.5 0 0 1 4 19.5V11a3 3 0 0 1 3-3Z" /><path d="M4 13H2.5a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 2.5 19H4M20 13h1.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H20M7.5 15h9v5h-9zM9.5 17.5h5" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></>,
}

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return <svg aria-hidden={label ? undefined : true} aria-label={label} className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
