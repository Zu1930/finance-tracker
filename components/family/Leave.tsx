'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Alert, AuthFrame } from '../auth/AuthForms'

type Preview = { dissolves: boolean; others: string[] }

/** Выход из семьи: последствия и слово ВЫЙТИ вместо window.confirm */
export function Leave() {
	const [p, setP] = useState<Preview | null>(null)
	const [word, setWord] = useState('')
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		fetch('/api/family/leave', { cache: 'no-store' })
			.then(async (r) => {
				const j = await r.json().catch(() => ({}))
				if (r.ok) setP(j as Preview)
				else setError((j as { error?: string }).error ?? 'Не удалось загрузить')
			})
			.catch(() => setError('Сервер недоступен'))
	}, [])

	const leave = async () => {
		setBusy(true)
		setError('')
		const res = await fetch('/api/family/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: word }) }).catch(() => null)
		const j = (await res?.json().catch(() => null)) as { householdId?: string; error?: string } | null
		if (res?.ok && j?.householdId) return void (window.location.href = `/review/${j.householdId}`)
		setBusy(false)
		setError(j?.error ?? 'Не удалось выйти из семьи')
	}

	const names = p?.others.join(', ') ?? ''
	return (
		<AuthFrame title="Выход из семьи" footer={<Link href="/settings" className="tb">Отмена</Link>}>
			{!p && !error && <p className="mt-6 text-muted">…</p>}
			{p && (
				<>
					<ul className="mt-6 space-y-3 uppercase">
						{p.dissolves ? (
							<>
								<li>&gt; Семья будет распущена: в ней останется {names || 'никого'}.</li>
								<li>&gt; У каждого появится личный бюджет с его личными тратами, доходами, счетами, копилками, категориями и регулярными.</li>
								<li>&gt; Семейные траты, счета и копилки останутся в архиве на 90 дней — только для чтения.</li>
								<li>&gt; Восстановить общий бюджет можно в течение 90 дней, если согласятся оба.</li>
							</>
						) : (
							<>
								<li>&gt; Семья продолжит работать без вас: {names}.</li>
								<li>&gt; Ваши личные данные перейдут в ваш личный бюджет.</li>
								<li>&gt; Семейные данные до сегодняшнего дня будут в архиве на 90 дней — только для чтения.</li>
							</>
						)}
						<li>&gt; Вы больше не увидите ничего нового в семье, остальные — ничего вашего, даже суммы. Уведомлений никто не получит.</li>
						<li>&gt; Семейные счета и регулярные платежи можно будет забрать к себе на следующем шаге.</li>
					</ul>
					<div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
						<label htmlFor="leave-word" className="lbl">Введите ВЫЙТИ</label>
						<input id="leave-word" className="tfield flex-1 uppercase" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
					</div>
					<button className="tb mt-6 h-12 w-full font-bold text-bad sm:h-auto" disabled={busy || word.trim().toUpperCase() !== 'ВЫЙТИ'} onClick={() => void leave()}>
						{busy ? 'Выхожу…' : 'Выйти из семьи'}
					</button>
				</>
			)}
			<Alert text={error.replace(/\.$/, '')} />
		</AuthFrame>
	)
}
