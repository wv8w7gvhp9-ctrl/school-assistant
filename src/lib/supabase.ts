import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type SupabaseConfig = {
  url: string
  publishableKey: string
}

export function readSupabaseConfig(env: Record<string, string | undefined>): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim()
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !publishableKey) return null

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) return null
  } catch {
    return null
  }

  return { url, publishableKey }
}

const config = readSupabaseConfig(import.meta.env)

export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
