import { useEffect, useRef, useState } from 'react'
import { canDeleteFamily, familyDeletionConfirmation } from '../domain/familyDeletion'
import { clearOfflineDataForChild, clearOfflineDataForParent } from '../lib/offlineCache'
import { supabase } from '../lib/supabase'
import { useOnlineStatus } from './NetworkStatus'

type DeletedFamilyRow = { deleted_family_id: string; deleted_child_id: string }

export function ParentFamilyDeletion({ parentUserId, childId, childName, onDeleted }: {
  parentUserId: string
  childId: string
  childName: string
  onDeleted: (message: string) => void
}) {
  const online = useOnlineStatus()
  const [confirming, setConfirming] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const confirmationInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (confirming) confirmationInput.current?.focus()
  }, [confirming])

  function closeConfirmation() {
    if (deleting) return
    setConfirming(false)
    setConfirmation('')
    setError('')
  }

  async function deleteFamily() {
    if (!supabase || !online || deleting || !canDeleteFamily(confirmation)) return
    setDeleting(true)
    setError('')
    const { data, error: deletionError } = await supabase.rpc('delete_my_family_profile', {
      input_confirmation: confirmation.trim(),
    })

    if (deletionError) {
      setDeleting(false)
      if (deletionError.code === '22023') setError(`Введите слово ${familyDeletionConfirmation} без дополнительных слов.`)
      else if (deletionError.code === '42501') setError('Сессия родителя истекла или семейный профиль уже недоступен. Обновите страницу и войдите снова.')
      else setError('Сервер не удалил семейный профиль. Данные сохранены; проверьте интернет и повторите попытку.')
      return
    }

    const deleted = (data?.[0] as DeletedFamilyRow | undefined)
    if (!deleted?.deleted_family_id || deleted.deleted_child_id !== childId) {
      setDeleting(false)
      setError('Сервер не подтвердил полное удаление. Обновите страницу перед повторной попыткой.')
      return
    }

    try {
      await Promise.all([clearOfflineDataForChild(childId), clearOfflineDataForParent(parentUserId)])
      onDeleted('Семейный профиль и его облачные данные удалены. Родительский аккаунт сохранён.')
    } catch (cacheError) {
      console.warn('Не удалось очистить локальные семейные данные после удаления профиля', cacheError)
      onDeleted('Семейный профиль удалён из облака, но браузеру не удалось очистить локальную копию. Очистите данные этого сайта в настройках браузера.')
    }
  }

  return <section className="parent-family-deletion" aria-labelledby="family-deletion-title">
    <div className="parent-section-heading"><div><p className="eyebrow">Опасное действие</p><h2 id="family-deletion-title">Удалить семейный профиль</h2><p>Родительский вход останется, но данные семьи восстановить через приложение будет нельзя.</p></div></div>
    {!confirming && <button type="button" className="danger-button family-delete-trigger" onClick={() => setConfirming(true)}>Удалить семейный профиль</button>}
    {confirming && <div className="parent-confirm family-delete-confirm" role="alertdialog" aria-labelledby="family-delete-confirm-title" aria-describedby="family-delete-consequences">
      <strong id="family-delete-confirm-title">Удалить профиль ребёнка «{childName}» и все данные семьи?</strong>
      <ul id="family-delete-consequences">
        <li>Будут удалены расписание, домашка, книги, кружки, звёздочки и история.</li>
        <li>Подключённые детские устройства и push‑подписки потеряют доступ к новым данным.</li>
        <li>Офлайн‑копии, уже сохранённые на другом устройстве, нельзя стереть дистанционно.</li>
      </ul>
      <label htmlFor="family-delete-confirmation">Для подтверждения введите {familyDeletionConfirmation}</label>
      <input ref={confirmationInput} id="family-delete-confirmation" type="text" autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError('') }} disabled={deleting} />
      {!online && <p className="auth-message warning" role="status">Для удаления нужен интернет. Семейные данные пока не изменены.</p>}
      {error && <p className="auth-message error" role="alert">{error}</p>}
      <div className="family-delete-actions"><button type="button" className="secondary-button" onClick={closeConfirmation} disabled={deleting}>Отмена</button><button type="button" className="danger-button" onClick={() => void deleteFamily()} disabled={deleting || !online || !canDeleteFamily(confirmation)}>{deleting ? 'Удаляем данные…' : 'Удалить навсегда'}</button></div>
    </div>}
  </section>
}
