import { describe, expect, it } from 'vitest'
import { readSupabaseConfig } from './supabase'

describe('конфигурация Supabase', () => {
  it('принимает только полный HTTPS URL проекта и publishable key', () => {
    expect(readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://school-assistant.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    })).toEqual({
      url: 'https://school-assistant.supabase.co',
      publishableKey: 'sb_publishable_example',
    })
  })

  it('не создаёт клиента с неполными или небезопасными параметрами', () => {
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'http://school-assistant.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'key' })).toBeNull()
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://example.com', VITE_SUPABASE_PUBLISHABLE_KEY: 'key' })).toBeNull()
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://school-assistant.supabase.co' })).toBeNull()
  })
})
