export type BackpackReviewRow = {
  checklist_id: string
  child_name: string
  target_day: string
  status: 'pending_review'
  item_id: string
  item_text: string
  checked: boolean
}

export type BackpackReview = {
  checklistId: string
  childName: string
  targetDay: string
  items: BackpackReviewRow[]
}

type ReviewQueueError = { code?: string; message?: string } | null

export const reviewQueueRefreshIntervalMs = 8_000

export function isMissingParentBookReviewsRpc(error: ReviewQueueError) {
  if (!error) return false
  return error.code === 'PGRST202'
    || error.code === '42883'
    || error.message?.includes('get_parent_book_reviews') === true
}

export function groupBackpackReviews(rows: BackpackReviewRow[]) {
  const grouped = new Map<string, BackpackReview>()
  for (const row of rows) {
    const current = grouped.get(row.checklist_id) ?? {
      checklistId: row.checklist_id,
      childName: row.child_name,
      targetDay: row.target_day,
      items: [],
    }
    current.items.push(row)
    grouped.set(row.checklist_id, current)
  }
  return [...grouped.values()]
}

export function reviewCountLabel(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} решений`
  if (last === 1) return `${count} решение`
  if (last >= 2 && last <= 4) return `${count} решения`
  return `${count} решений`
}

export function reviewAwardMessage(kind: 'book' | 'backpack', starsAwarded: number) {
  const subject = kind === 'book' ? 'Книга подтверждена' : 'Рюкзак подтверждён'
  if (starsAwarded <= 0) return `${subject}. Звёзды за это основание уже были начислены.`
  if (starsAwarded === 1) return `${subject}. Начислена одна звезда.`
  if (starsAwarded === 3) return `${subject}. Начислены три звезды.`
  return `${subject}. Начислено звёзд: ${starsAwarded}.`
}
