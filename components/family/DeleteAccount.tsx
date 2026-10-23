'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SW_CACHE } from '@/lib/offline'
import { Alert, AuthFrame, Field } from '../auth/AuthForms'

/** Удаление аккаунта: пароль и слово УДАЛИТЬ */
export function DeleteAccount() {
	const [password, setPassword] = useState('')
	const [word, setWord] = useState('')
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const [done, setDone] = useState(false)

	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		setBusy(true)
		setError('')
		const res = await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, confirm: word }) }).catch(() => null)
		setBusy(false)
		if (res?.ok) {
			try {
				await caches.delete(SW_CACHE)
				localStorage.clear()
			} catch {}
			return setDone(true)
		}
		setError(((await res?.json().catch(() => null)) as { error?: string } | null)?.error?.replace(/\.$/, '') ?? 'Не удалось удалить аккаунт')
	}

	if (done) {
		return (
			<AuthFrame title="Аккаунт удалён" footer={<Link href="/login" className="tb">Ко входу</Link>}>
				<p className="mt-6 uppercase">&gt; Аккаунт и личные данные удалены. Подтверждение отправлено на email.</p>
			</AuthFrame>
		)
	}
	return (
		<AuthFrame title="Удаление аккаунта" footer={<><Link href="/settings" className="tb">Отмена</Link><a href="/api/account/export" className="tb">Экспорт всех моих данных</a></>}>
			<ul className="mt-6 space-y-3 uppercase">
				<li>&gt; Если вы в семье — сначала выполнится выход: при паре семья распустится, общее останется в архиве у второго участника.</li>
				<li>&gt; Удалятся ваш личный бюджет и все личные данные: траты, доходы, счета, копилки, категории, регулярные, токены Быстрых команд.</li>
				<li>&gt; Ваши записи в семейных данных и архивах останутся у других и будут подписаны «Удалённый пользователь».</li>
				<li>&gt; Восстановить аккаунт нельзя. Сначала скачайте экспорт, если нужен.</li>
			</ul>
			<form onSubmit={submit}>
				<Field id="del-pw" label="Пароль" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
				<Field id="del-word" label="Введите УДАЛИТЬ" autoComplete="off" className="tfield flex-1 uppercase" value={word} onChange={(e) => setWord(e.target.value)} />
				<button className="tb mt-6 h-12 w-full font-bold text-bad sm:h-auto" disabled={busy || !password || word.trim().toUpperCase() !== 'УДАЛИТЬ'}>
					{busy ? 'Удаляю…' : 'Удалить аккаунт'}
				</button>
				<Alert text={error} />
			</form>
		</AuthFrame>
	)
}
