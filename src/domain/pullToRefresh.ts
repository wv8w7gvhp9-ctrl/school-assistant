export const pullRefreshThreshold = 64

export type PullPoint = { x: number; y: number }

export function pullRefreshDistance(start: PullPoint, current: PullPoint) {
  const horizontalDistance = Math.abs(current.x - start.x)
  const verticalDistance = current.y - start.y
  if (verticalDistance <= 0 || horizontalDistance > verticalDistance) return 0
  return Math.min(96, verticalDistance * 0.8)
}

export function shouldRefreshAfterPull(distance: number) {
  return distance >= pullRefreshThreshold
}
