import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export function useHomeworkLiveUpdates(childId: string | undefined, online: boolean, refresh: () => void | Promise<void>) {
  const refreshRef = useRef(refresh)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    const client = supabase
    if (!client || !childId || !online) return

    const refreshVisibleScreen = () => {
      if (document.visibilityState === 'visible') void refreshRef.current()
    }
    const channel = client
      .channel(`child-homework-${childId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'homework_assignments',
        filter: `child_id=eq.${childId}`,
      }, refreshVisibleScreen)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Не удалось включить автоматическое обновление домашки', status)
        }
      })

    window.addEventListener('focus', refreshVisibleScreen)
    document.addEventListener('visibilitychange', refreshVisibleScreen)
    return () => {
      window.removeEventListener('focus', refreshVisibleScreen)
      document.removeEventListener('visibilitychange', refreshVisibleScreen)
      void client.removeChannel(channel)
    }
  }, [childId, online])
}
