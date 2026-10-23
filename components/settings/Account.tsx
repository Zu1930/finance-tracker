'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'
import { HoldLogout } from './HoldLogout'

type Session = { token: string; userAgent?: string | null; updatedAt: string; createdAt: string }
type Me = { user: { email: string; name: string }; session: { token: string } }

const MIN_PASSWORD = 10

/** Better Auth: POST /api/auth/<path>; null — нет связи */
const auth = (path: string, body: unknown = {}) =>
	fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)

const when = (iso: string) =>
	new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Устройство и браузер по User-Agent — примерно, для узнавания своих сессий */
export function device(ua: string | null | undefined): string {
	if (!ua) return 'Неизвестно'
	const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
	const browser = /Edg\//.test(ua) ? 'Edge' : /YaBrowser/.test(ua) ? 'Яндекс' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : ''
	return [os, browser].filter(Boolean).join(' · ') || ua.slice(0, 40)
}

/** Аккаунт: email, имя, смена пароля, активные сессии, выход */
export function Account() {
	const { toast, offline, reload } = useTracker()
	const [me, setMe] = useState<Me | null>(null)
	const [sessions, setSessions] = useState<Session[] | null>(null)
	const [name, setName] = useState('')
	const [busy, setBusy] = useState(false)

	const load = async () => {
		const [s, l] = await Promise.all([
			fetch('/api/auth/get-session', { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<Me | null>) : null)),
			fetch('/api/auth/list-sessions', { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<Session[]>) : [])),
		])
		if (s) {
			setMe(s)
			setName(s.user.name)
		}
		setSessions([...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
	}
	useEffect(() => {
		load().catch(() => setSessions([]))
	}, [])

	const run = async (path: string, body: unknown, done: string) => {
		setBusy(true)
		const res = await auth(path, body)
		setBusy(false)
		if (!res?.ok) return toast('Не удалось. Проверьте связь и повторите.')
		toast(done)
		await load()
	}
	const saveName = async () => {
		await run('update-user', { name: name.trim() }, 'Имя сохранено')
		await reload(true)
	}

	const current = me?.session.token
	const others = (sessions ?? []).filter((s) => s.token !== current)

	return (
		<div className="uppercase">
			<p>
				<span className="text-muted">Email:</span> <b className="normal-case">{me?.user.email ?? '…'}</b>
			</p>
			<div className="mt-3 flex flex-wrap items-center gap-3">
				<label htmlFor="acc-name" className="lbl">Имя</label>
				<input id="acc-name" className="tfield w-[20ch] normal-case max-sm:flex-1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
				<button className="tb max-sm:h-11 max-sm:w-full" disabled={busy || !!offline || !me || !name.trim() || name.trim() === me.user.name} onClick={() => void saveName()}>
					Сохранить
				</button>
			</div>

			<ChangePassword />

			<h3 className="mt-6 text-muted">Активные сессии</h3>
			{sessions === null ? (
				<p className="mt-2 text-muted">…</p>
			) : (
				<ul className="mt-2">
					{sessions.map((s) => (
						<li key={s.token} className="flex flex-wrap items-center gap-x-4 border-b border-dashed border-line2 py-1">
							<b className="normal-case">{device(s.userAgent)}</b>
							<span className="text-muted">Активность {when(s.updatedAt)}</span>
							{s.token === current ? (
								<span className="ml-auto text-muted2">// Это устройство</span>
							) : (
								<button className="tb ml-auto" disabled={busy || !!offline} onClick={() => void run('revoke-session', { token: s.token }, 'Сессия завершена')}>
									Завершить
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			<div className="mt-4 flex flex-wrap gap-3">
				<button className="tb max-sm:h-12 max-sm:w-full" disabled={busy || !!offline || !others.length} onClick={() => void run('revoke-other-sessions', {}, 'Другие сессии завершены')}>
					Выйти везде, кроме этого
				</button>
				<HoldLogout />
			</div>

			<div className="mt-6 flex flex-wrap gap-3 border-t border-dashed border-line2 pt-4">
				<a href="/api/account/export" className="tb max-sm:h-12 max-sm:w-full">Экспорт всех моих данных</a>
				<Link href="/delete-account" className="tb text-bad max-sm:h-12 max-sm:w-full">Удалить аккаунт</Link>
				<Link href="/privacy" className="tb max-sm:h-12 max-sm:w-full">Конфиденциальность</Link>
			</div>
		</div>
	)
}

/** Смена пароля: текущий + новый дважды. Текущая сессия остаётся, остальные завершаются */
function ChangePassword() {
	const { toast, offline } = useTracker()
	const [open, setOpen] = useState(false)
	const [cur, setCur] = useState('')
	const [next, setNext] = useState('')
	const [again, setAgain] = useState('')
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)

	const problem = next.length < MIN_PASSWORD ? `Новый пароль — минимум ${MIN_PASSWORD} символов` : next !== again ? 'Новые пароли не совпадают' : ''
	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (problem) return setError(problem)
		setBusy(true)
		setError('')
		const res = await auth('change-password', { currentPassword: cur, newPassword: next, revokeOtherSessions: true })
		setBusy(false)
		if (res?.ok) {
			setOpen(false)
			setCur('')
			setNext('')
			setAgain('')
			return toast('Пароль изменён, другие устройства вышли')
		}
		setError(!res ? 'Нет связи' : res.status === 429 ? 'Слишком много попыток, подождите' : res.status === 400 ? 'Неверный текущий пароль' : 'Не удалось сменить пароль')
	}

	if (!open) {
		return (
			<button className="tb mt-4 max-sm:h-12 max-sm:w-full" disabled={!!offline} onClick={() => setOpen(true)}>
				Сменить пароль
			</button>
		)
	}
	const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
		<div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
			<label htmlFor={id} className="lbl w-[16ch]">{label}</label>
			<input id={id} className="tfield flex-1" type="password" autoComplete={auto} value={value} onChange={(e) => set(e.target.value)} />
		</div>
	)
	return (
		<form className="mt-4 max-w-md border border-dashed border-line2 p-3" onSubmit={submit}>
			{field('pw-cur', 'Текущий', cur, setCur, 'current-password')}
			{field('pw-new', 'Новый', next, setNext, 'new-password')}
			{field('pw-again', 'Ещё раз', again, setAgain, 'new-password')}
			<p className="mt-2 text-muted2">// Минимум {MIN_PASSWORD} символов. Другие устройства выйдут</p>
			<div className="mt-3 flex gap-3">
				<button className="tb font-bold" disabled={busy || !cur || !next || !again}>{busy ? 'Сохраняю…' : 'Сменить пароль'}</button>
				<button type="button" className="tb" onClick={() => setOpen(false)}>Отмена</button>
			</div>
			<p className="mt-3 min-h-5 text-bad" role="alert">{error && `!! ${error}`}</p>
		</form>
	)
}
