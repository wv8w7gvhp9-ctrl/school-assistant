import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, turnstileSiteKey } from '../lib/supabase'
import { loadWithOfflineFallback, offlineKey } from '../lib/offlineCache'
import { ChildSessionProvider } from './ChildSession'
import { useOnlineStatus } from './NetworkStatus'
import { Turnstile } from './Turnstile'
import { ParentStarHistory } from './StarHistory'

const ParentScheduleEditor = lazy(() => import('./ParentScheduleEditor').then((module) => ({ default: module.ParentScheduleEditor })))
const ParentHomeworkEditor = lazy(() => import('./ParentHomeworkEditor').then((module) => ({ default: module.ParentHomeworkEditor })))
const ParentBooksEditor = lazy(() => import('./ParentBooksEditor').then((module) => ({ default: module.ParentBooksEditor })))
const ParentClubsEditor = lazy(() => import('./ParentClubsEditor').then((module) => ({ default: module.ParentClubsEditor })))
const ParentBackpackReview = lazy(() => import('./ParentBackpackReview').then((module) => ({ default: module.ParentBackpackReview })))
const ParentNotificationSettings = lazy(() => import('./ParentNotificationSettings').then((module) => ({ default: module.ParentNotificationSettings })))
const ParentChildDevices = lazy(() => import('./ParentChildDevices').then((module) => ({ default: module.ParentChildDevices })))

type AuthState = 'idle' | 'sending' | 'sent' | 'error'
type FamilyProfile = { family_id: string; child_id: string; child_name: string }
type LinkCode = { display_code: string; expires_at: string }
type ChildProfileRow = { child_id: string; child_name: string }

function MissingConfiguration({ children }: { children: ReactNode }) {
  return <>{children}<aside className="cloud-note" role="status"><strong>Облако не подключено в этой среде</strong><p>Добавьте публичные параметры Supabase в настройки окружения, чтобы проверить вход по почте.</p></aside></>
}

function ParentSignedIn({ session }: { session: Session }) {
  const [signingOut, setSigningOut] = useState(false)
  const [family, setFamily] = useState<FamilyProfile | null>(null)
  const [loadingFamily, setLoadingFamily] = useState(true)
  const [childName, setChildName] = useState('')
  const [creatingFamily, setCreatingFamily] = useState(false)
  const [familyError, setFamilyError] = useState('')
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null)
  const [creatingCode, setCreatingCode] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void supabase.rpc('get_my_family').then(({ data, error }) => {
      if (error) setFamilyError('Не удалось загрузить семейный профиль. Попробуйте обновить страницу.')
      else setFamily((data?.[0] as FamilyProfile | undefined) ?? null)
      setLoadingFamily(false)
    })
  }, [])

  async function signOut() {
    if (!supabase) return
    setSigningOut(true)
    await supabase.auth.signOut()
    setSigningOut(false)
  }

  async function createFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !childName.trim()) return
    setCreatingFamily(true)
    setFamilyError('')
    const { data, error } = await supabase.rpc('create_family', { child_display_name: childName.trim() })
    if (error) setFamilyError(error.code === '23505' ? 'Семейный профиль уже создан. Обновите страницу.' : 'Не удалось создать семейный профиль. Проверьте имя и повторите попытку.')
    else setFamily((data?.[0] as FamilyProfile | undefined) ?? null)
    setCreatingFamily(false)
  }

  async function createLinkCode() {
    if (!supabase) return
    setCreatingCode(true)
    setFamilyError('')
    const { data, error } = await supabase.rpc('create_child_link_code')
    if (error) setFamilyError('Не удалось создать код. Обновите страницу и повторите попытку.')
    else setLinkCode((data?.[0] as LinkCode | undefined) ?? null)
    setCreatingCode(false)
  }

  return <main className="auth-page"><section className="auth-card parent-card">
    <p className="eyebrow">Вход подтверждён</p><h1>Здравствуйте!</h1><p>Вы вошли как родитель: {session.user.email}.</p>
    {loadingFamily && <p className="auth-loading">Проверяем семейный профиль…</p>}
    {!loadingFamily && !family && <form className="auth-form" onSubmit={createFamily}><label htmlFor="child-name">Как зовут ребёнка?</label><p className="field-help">Достаточно имени или домашнего псевдонима. Другие личные данные не нужны.</p><input id="child-name" name="child-name" type="text" autoComplete="off" maxLength={48} value={childName} onChange={(event) => { setChildName(event.target.value); setFamilyError('') }} placeholder="Например, Миша" required /><button className="primary-button" type="submit" disabled={creatingFamily}>{creatingFamily ? 'Создаём профиль…' : 'Создать семейный профиль'}</button></form>}
    {family && <div className="family-success" role="status"><strong>Семья создана</strong><p>Профиль ребёнка: {family.child_name}.</p></div>}
    {family && <Suspense fallback={<p className="auth-loading" role="status">Открываем данные семьи…</p>}><ParentScheduleEditor familyId={family.family_id} /><ParentHomeworkEditor familyId={family.family_id} childId={family.child_id} /><ParentBooksEditor familyId={family.family_id} childId={family.child_id} /><ParentClubsEditor familyId={family.family_id} childId={family.child_id} /><ParentBackpackReview /><ParentStarHistory childId={family.child_id} childName={family.child_name} /><ParentNotificationSettings /><ParentChildDevices /></Suspense>}
    {family && <section className="link-code-panel"><h2>Подключить устройство ребёнка</h2><p>Откройте приложение на устройстве ребёнка, выберите «Подключить устройство ребёнка» и введите этот код.</p>{linkCode ? <div className="link-code" role="status"><strong>{linkCode.display_code}</strong><span>Код действует 15 минут и сработает только один раз.</span></div> : <button type="button" className="primary-button" onClick={createLinkCode} disabled={creatingCode}>{creatingCode ? 'Создаём код…' : 'Получить код подключения'}</button>}</section>}
    {familyError && <p className="auth-message error" role="alert">{familyError}</p>}
    <button type="button" className="secondary-button auth-button" onClick={signOut} disabled={signingOut}>{signingOut ? 'Выходим…' : 'Выйти'}</button>
  </section></main>
}

function ChildConnect({ onBack, onLinkStart }: { onBack: () => void; onLinkStart: () => void }) {
  const [code, setCode] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [state, setState] = useState<'idle' | 'connecting' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const onToken = useCallback((token: string) => { setCaptchaToken(token); setMessage('') }, [])
  const onCaptchaError = useCallback(() => { setCaptchaToken(''); setMessage('Проверка не прошла. Обновите страницу и попробуйте снова.') }, [])

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !captchaToken || !code.trim()) return
    setState('connecting')
    setMessage('')
    onLinkStart()
    const { error: signInError } = await supabase.auth.signInAnonymously({ options: { captchaToken } })
    if (signInError) { setState('error'); setMessage('Не удалось начать защищённое подключение. Попробуйте ещё раз.'); return }
    const { error: redeemError } = await supabase.rpc('redeem_child_link_code', { input_code: code })
    if (redeemError) {
      await supabase.auth.signOut()
      setState('error')
      setMessage('Код не подошёл или его время закончилось. Попросите родителя создать новый код.')
      return
    }
  }

  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">Для ребёнка</p><h1>Подключить устройство</h1><p>Попроси родителя показать короткий код. Почта и пароль не нужны.</p>{turnstileSiteKey ? <form className="auth-form" onSubmit={connect}><label htmlFor="child-code">Код подключения</label><input id="child-code" name="child-code" type="text" inputMode="text" autoComplete="one-time-code" maxLength={14} value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setMessage('') }} placeholder="ABCD-EFGH-IJKL" required /><Turnstile siteKey={turnstileSiteKey} onToken={onToken} onError={onCaptchaError} /><button className="primary-button" type="submit" disabled={state === 'connecting' || !captchaToken}>{state === 'connecting' ? 'Подключаем…' : 'Подключить устройство'}</button></form> : <p className="auth-message error" role="alert">Защита подключения ещё не настроена. Попросите родителя завершить настройку.</p>}{message && <p className="auth-message error" role="alert">{message}</p>}<button type="button" className="text-button auth-back" onClick={onBack}>Я родитель</button></section></main>
}

function ChildSignedIn({ sessionUserId, waitForLink, onLinkResolved, onReconnect, children }: { sessionUserId: string; waitForLink: boolean; onLinkResolved: () => void; onReconnect: () => Promise<void>; children: ReactNode }) {
  const online = useOnlineStatus()
  const [profile, setProfile] = useState<{ childId: string; childName: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const client = supabase
    if (!client) return
    let cancelled = false
    let attempts = 0
    let retryTimer: number | null = null
    const loadProfile = async () => {
      if (cancelled) return
      const result = await loadWithOfflineFallback<ChildProfileRow[]>(
        offlineKey.childProfile(sessionUserId),
        () => client.rpc('get_my_child_profile'),
        online,
      )
      if (cancelled) return
      const child = result.data?.[0]
      if (child) {
        setProfile({ childId: child.child_id, childName: child.child_name })
        setError('')
        onLinkResolved()
        return
      }
      attempts += 1
      if (online && waitForLink && attempts < 8) {
        retryTimer = window.setTimeout(loadProfile, 350)
        return
      }
      setProfile(null)
      setError(online ? 'Устройство ещё не подключено. Попроси родителя создать новый код.' : 'Нет интернета, а профиль ребёнка ещё не сохранён на этом устройстве. Подключись к сети и открой приложение один раз.')
    }
    void loadProfile()
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [online, onLinkResolved, sessionUserId, waitForLink])
  if (profile) return <ChildSessionProvider profile={profile}>{children}</ChildSessionProvider>
  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">Устройство ребёнка</p><h1>{error ? 'Устройство отключено' : 'Подключаем устройство…'}</h1>{error ? <><p className="auth-message error" role="alert">{error}</p>{online && <button type="button" className="primary-button" onClick={() => void onReconnect()}>Подключить заново</button>}</> : <p className="auth-loading">Проверяем код…</p>}</section></main>
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [email, setEmail] = useState('')
  const [state, setState] = useState<AuthState>('idle')
  const [screen, setScreen] = useState<'parent' | 'child'>('parent')
  const [childLinkPending, setChildLinkPending] = useState(false)
  const handleChildLinkResolved = useCallback(() => setChildLinkPending(false), [])
  const reconnectChild = useCallback(async () => {
    if (!supabase) return
    setChildLinkPending(false)
    setScreen('child')
    await supabase.auth.signOut()
  }, [])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !email.includes('@')) return
    setState('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/` },
    })
    setState(error ? 'error' : 'sent')
  }

  if (!supabase) return <MissingConfiguration>{children}</MissingConfiguration>
  if (loading) return <main className="auth-page"><p className="auth-loading">Проверяем безопасную сессию…</p></main>
  if (session?.user.is_anonymous) return <ChildSignedIn sessionUserId={session.user.id} waitForLink={childLinkPending} onLinkResolved={handleChildLinkResolved} onReconnect={reconnectChild}>{children}</ChildSignedIn>
  if (session) return <ParentSignedIn session={session} />

  if (screen === 'child') return <ChildConnect onBack={() => setScreen('parent')} onLinkStart={() => setChildLinkPending(true)} />
  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">Для родителя</p><h1>Войдите по почте</h1><p>Мы отправим безопасную ссылку для входа. Ребёнку почта и пароль не понадобятся: его устройство подключается отдельно по короткому коду.</p><form className="auth-form" onSubmit={sendMagicLink}><label htmlFor="parent-email">Электронная почта</label><input id="parent-email" name="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => { setEmail(event.target.value); setState('idle') }} placeholder="name@example.com" required /><button className="primary-button" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Отправляем ссылку…' : 'Получить ссылку для входа'}</button></form>{state === 'sent' && <p className="auth-message success" role="status">Письмо отправлено. Откройте ссылку из почты в этом же браузере.</p>}{state === 'error' && <p className="auth-message error" role="alert">Не удалось отправить письмо. Проверьте адрес и повторите попытку.</p>}<button type="button" className="text-button auth-back" onClick={() => setScreen('child')}>Подключить устройство ребёнка</button></section></main>
}
