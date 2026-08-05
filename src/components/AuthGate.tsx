import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type AuthState = 'idle' | 'sending' | 'sent' | 'error'

function MissingConfiguration({ children }: { children: ReactNode }) {
  return <>{children}<aside className="cloud-note" role="status"><strong>Облако не подключено в этой среде</strong><p>Добавьте публичные параметры Supabase в настройки окружения, чтобы проверить вход по почте.</p></aside></>
}

function ParentSignedIn({ session }: { session: Session }) {
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    if (!supabase) return
    setSigningOut(true)
    await supabase.auth.signOut()
    setSigningOut(false)
  }

  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">Вход подтверждён</p><h1>Здравствуйте!</h1><p>Вы вошли как родитель: {session.user.email}.</p><p>Далее мы добавим создание семейного профиля и безопасное подключение устройства ребёнка по одноразовому коду.</p><button type="button" className="secondary-button auth-button" onClick={signOut} disabled={signingOut}>{signingOut ? 'Выходим…' : 'Выйти'}</button></section></main>
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [email, setEmail] = useState('')
  const [state, setState] = useState<AuthState>('idle')

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
  if (session) return <ParentSignedIn session={session} />

  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">Для родителя</p><h1>Войдите по почте</h1><p>Мы отправим безопасную ссылку для входа. Ребёнку почта и пароль не понадобятся: его устройство подключается отдельно по короткому коду.</p><form className="auth-form" onSubmit={sendMagicLink}><label htmlFor="parent-email">Электронная почта</label><input id="parent-email" name="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => { setEmail(event.target.value); setState('idle') }} placeholder="name@example.com" required /><button className="primary-button" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Отправляем ссылку…' : 'Получить ссылку для входа'}</button></form>{state === 'sent' && <p className="auth-message success" role="status">Письмо отправлено. Откройте ссылку из почты в этом же браузере.</p>}{state === 'error' && <p className="auth-message error" role="alert">Не удалось отправить письмо. Проверьте адрес и повторите попытку.</p>}</section></main>
}
