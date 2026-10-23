'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Alert, AuthFrame } from './AuthForms'

type Preview = { inviter: string; members: number; base: string | null; myBase: string | null; needsRate: boolean }

/** Подтверждение приглашения в семью: что произойдёт с данными; при разных базовых валютах — курс */
export function JoinScreen({ code }: { code: string }) {
	const [p, setP] = useState<Preview | null>(null)
	const [refusal, setRefusal] = useState('')
	const [rate, setRate] = useState('')
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		fetch(`/api/join/${encodeURIComponent(code)}`, { cache: 'no-store' })
			.then(async (r) => {
				if (r.status === 401) return void (window.location.href = `/login?next=${encodeURIComponent(`/join/${code}`)}`)
				const j = await r.json().catch(() => ({}))
				if (r.ok) setP(j as Preview)
				else setRefusal((j as { error?: string }).error ?? 'Приглашение недействительно')
			})
			.catch(() => setRefusal('Сервер недоступен'))
	}, [code])

	const accept = async () => {
		const n = Number(rate.replace(',', '.'))
		if (p?.needsRate && !(n > 0)) return setError(`Укажите курс: сколько ${p.myBase} стоит 1 ${p.base}`)
		setBusy(true)
		setError('')
		const res = await fetch(`/api/join/${encodeURIComponent(code)}`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p?.needsRate ? { rate: n } : {}),
		}).catch(() => null)
		if (res?.ok) return void (window.location.href = '/')
		setBusy(false)
		setError(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Не удалось принять приглашение')
	}

	const who = p && (p.members > 1 ? 'Участники семьи' : p.inviter)
	return (
		<AuthFrame title="Приглашение в семью" footer={<Link href="/" className="tb">{p ? 'Не сейчас' : 'На главную'}</Link>}>
			{!p && !refusal && <p className="mt-6 text-muted">…</p>}
			{refusal && <p className="mt-6 text-bad uppercase" role="alert">!! {refusal.replace(/\.$/, '')}</p>}
			{p && (
				<>
					<p className="mt-6 uppercase">&gt; <b>{p.inviter}</b> приглашает вас в общий бюджет{p.members > 1 ? ` (участников: ${p.members})` : ''}</p>
					<p className="mt-4 uppercase">
						Ваши траты, счета, копилки и категории останутся личными и перейдут в общий бюджет. {who} их не {p.members > 1 ? 'увидят' : 'увидит'}.
					</p>
					<p className="mt-3 text-muted2">
						// Видны будут только суммы ваших личных трат за месяц, как у всех в семье. Доходы до вступления не переносятся: в семье доходы видны всем. Сохраните их заранее: Настройки → Экспорт JSON
					</p>
					{p.needsRate && (
						<div className="mt-5">
							<p className="uppercase">!! У семьи другая валюта лимитов: {p.base}. Ваши данные пересчитаются в {p.base}</p>
							<div className="mt-3 flex flex-wrap items-center gap-3 uppercase">
								<label htmlFor="join-rate" className="lbl">1 {p.base} =</label>
								<input id="join-rate" className="tfield w-[12ch] text-right" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ''))} />
								<span>{p.myBase}</span>
							</div>
						</div>
					)}
					<button className="tb mt-6 h-12 w-full font-bold sm:h-auto" disabled={busy || (p.needsRate && !rate)} onClick={() => void accept()}>
						{busy ? 'Переношу данные…' : 'Принять приглашение'}
					</button>
					<Alert text={error.replace(/\.$/, '')} />
				</>
			)}
		</AuthFrame>
	)
}
