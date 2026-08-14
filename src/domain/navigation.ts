import type { ChildTab } from './types'

const childTabs = new Set<ChildTab>(['today', 'schedule', 'homework', 'books', 'clubs'])

export function childTabFromSearch(search: string): ChildTab {
  const tab = new URLSearchParams(search).get('tab')
  return tab && childTabs.has(tab as ChildTab) ? tab as ChildTab : 'today'
}

export function searchForChildTab(search: string, tab: ChildTab) {
  const params = new URLSearchParams(search)
  if (tab === 'today') params.delete('tab')
  else params.set('tab', tab)
  const value = params.toString()
  return value ? `?${value}` : ''
}
