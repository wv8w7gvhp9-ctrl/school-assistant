import { createClient } from 'npm:@supabase/supabase-js@2.112.0'
import { extractRecommendedPeriods, findCalendarDocument } from './parser.ts'

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' }
const officialIndexUrl = 'https://www.fgbu-ac.ru/zakonodatelstvo-ob-obrazovanii/documents-of-week.php'
const sourceTimeoutMs = 3_500

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function samaraDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Samara', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function loadText(url: string) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'SchoolAssistantCalendarSync/1.0 (+https://school-assistant-one.vercel.app)' },
    signal: AbortSignal.timeout(sourceTimeoutMs),
  })
  if (!response.ok) throw new Error(`Source returned ${response.status}`)
  return response.text()
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  try {
    if (request.headers.get('x-cron-secret') !== requiredEnv('CRON_SECRET')) {
      return new Response('Unauthorized', { status: 401 })
    }

    const current = samaraDate()
    if (current.month < 5 || current.month > 9 || (current.month === 5 && current.day < 30)) {
      return new Response(JSON.stringify({ state: 'outside_update_window' }), { status: 200, headers: jsonHeaders })
    }
    const academicStartYear = current.year
    const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: preparedBefore, error: prepareError } = await supabase.rpc('prepare_school_calendar_year', {
      input_academic_start_year: academicStartYear,
    })
    if (prepareError) throw prepareError

    const archiveResults = await Promise.allSettled(
      [6, 7, 8, 9].map((month) =>
        loadText(`https://www.consultant.ru/document/chronomap/${academicStartYear}/${month}/`)),
    )
    let document = null
    for (const result of archiveResults) {
      if (result.status !== 'fulfilled') continue
      document = findCalendarDocument(result.value, academicStartYear)
      if (document) break
    }
    if (!document) {
      const state = archiveResults.some((result) => result.status === 'fulfilled')
        ? 'source_not_published'
        : 'source_temporarily_unavailable'
      return new Response(JSON.stringify({ state, year: academicStartYear, prepared: preparedBefore }), {
        status: 200, headers: jsonHeaders,
      })
    }

    let documentHtml: string
    try {
      documentHtml = await loadText(document.url)
    } catch {
      return new Response(JSON.stringify({ state: 'source_temporarily_unavailable', year: academicStartYear }), {
        status: 200, headers: jsonHeaders,
      })
    }
    const periods = extractRecommendedPeriods(documentHtml, academicStartYear)
    if (!periods) {
      return new Response(JSON.stringify({ state: 'source_temporarily_unavailable', year: academicStartYear }), {
        status: 200, headers: jsonHeaders,
      })
    }

    const contentHash = await sha256(JSON.stringify(periods))
    const { error: sourceError } = await supabase.rpc('upsert_school_calendar_source', {
      input_academic_start_year: academicStartYear,
      input_document_title: document.title,
      input_document_number: document.documentNumber,
      input_published_on: document.publishedOn,
      input_source_url: document.url,
      input_official_index_url: officialIndexUrl,
      input_periods: periods,
      input_content_hash: contentHash,
    })
    if (sourceError) throw sourceError

    const { data: preparedAfter, error: proposalError } = await supabase.rpc('prepare_school_calendar_year', {
      input_academic_start_year: academicStartYear,
    })
    if (proposalError) throw proposalError

    return new Response(JSON.stringify({ state: 'proposal_ready', year: academicStartYear, prepared: preparedAfter }), {
      status: 200, headers: jsonHeaders,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'School calendar sync failed')
    return new Response(JSON.stringify({ error: 'School calendar sync failed' }), { status: 500, headers: jsonHeaders })
  }
})
