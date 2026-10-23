'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTracker } from '../../TrackerProvider'
import { HoldLogout } from '../HoldLogout'
import { Block } from '../SettingsFrame'
import { DangerZone, SettingsRow } from '../Kit'

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

/** Аккаунт: профиль, вход (пароль, сессии, выход), удаление */
export function AccountPage() {
	const { toast, offline, reload } = useTracker()
	const [me, setMe] = useState<Me | null>(null)
	const [sessions, setSessions] = useState<Session[] | null>(null)
	const [name, setName] = useState('')
	const [busy, setBusy] = useState(false)
	const [pwOpen, setPwOpen] = useState(false)

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
	// Имя сохраняется само: по уходу из поля или Enter, без отдельной кнопки
	const saveName = async () => {
		const v = name.trim()
		if (!me || !v || v === me.user.name || offline) return setName(me?.user.name ?? v)
		await run('update-user', { name: v }, 'Имя сохранено')
		await reload(true)
	}

	const current = me?.session.token
	const others = (sessions ?? []).filter((s) => s.token !== current)

	return (
		<>
			<Block title="Профиль">
				<SettingsRow end={<b className="normal-case">{me?.user.email ?? '…'}</b>}>
					<span className="text-muted uppercase">Email</span>
				</SettingsRow>
				<SettingsRow end={
					<input id="acc-name" aria-label="Имя" className="tfield w-[20ch] text-right normal-case" value={name} maxLength={40} disabled={!me}
						onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()}
						onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
				}>
					<label htmlFor="acc-name" className="text-muted uppercase">Имя</label>
				</SettingsRow>
			</Block>

			<Block title="Вход">
				<SettingsRow end={<button className="tb uppercase" disabled={!!offline} aria-expanded={pwOpen} onClick={() => setPwOpen((o) => !o)}>{pwOpen ? 'Свернуть' : 'Сменить'}</button>}>
					<span className="uppercase">Пароль</span>
				</SettingsRow>
				{pwOpen && <ChangePassword onDone={() => setPwOpen(false)} />}

				<h3 className="mt-5 text-xs text-muted uppercase">Активные сессии</h3>
				{sessions === null ? (
					<p className="mt-2 text-muted">…</p>
				) : (
					sessions.map((s) => (
						<SettingsRow key={s.token} end={
							s.token === current ? <span className="text-muted uppercase">сейчас</span>
							: <>
								<span className="text-xs text-muted">{when(s.updatedAt)}</span>
								<button className="tb uppercase" disabled={busy || !!offline} onClick={() => void run('revoke-session', { token: s.token }, 'Сессия завершена')}>Завершить</button>
							</>
						}>
							<b className="normal-case">{device(s.userAgent)}</b>
							{s.token === current && <span className="text-muted"> // это устройство</span>}
						</SettingsRow>
					))
				)}
				<div className="mt-4 flex flex-wrap gap-3 uppercase">
					<button className="tb max-sm:h-12 max-sm:w-full" disabled={busy || !!offline || !others.length} onClick={() => void run('revoke-other-sessions', {}, 'Другие сессии завершены')}>
						Выйти везде, кроме этого
					</button>
					<HoldLogout />
				</div>
			</Block>

			<DangerZone title="Удаление аккаунта" action="Удалить аккаунт…" href="/delete-account">
				Сначала скачается экспорт. Личные данные удаляются сразу и безвозвратно.
			</DangerZone>

			<p className="mt-7"><Link href="/privacy" className="text-muted underline underline-offset-4 hover:text-link-hover">Конфиденциальность</Link></p>
		</>
	)
}

/** Смена пароля: текущий + новый дважды. Текущая сессия остаётся, остальные завершаются */
function ChangePassword({ onDone }: { onDone: () => void }) {
	const { toast } = useTracker()
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
			onDone()
			return toast('Пароль изменён, другие устройства вышли')
		}
		setError(!res ? 'Нет связи' : res.status === 429 ? 'Слишком много попыток, подождите' : res.status === 400 ? 'Неверный текущий пароль' : 'Не удалось сменить пароль')
	}
	const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
		<div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
			<label htmlFor={id} className="lbl w-[16ch]">{label}</label>
			<input id={id} className="tfield flex-1" type="password" autoComplete={auto} value={value} onChange={(e) => set(e.target.value)} />
		</div>
	)
	return (
		<form className="mt-3 max-w-md border border-dashed border-line2 p-3 uppercase" onSubmit={submit}>
			{field('pw-cur', 'Текущий', cur, setCur, 'current-password')}
			{field('pw-new', 'Новый', next, setNext, 'new-password')}
			{field('pw-again', 'Ещё раз', again, setAgain, 'new-password')}
			<p className="mt-2 text-xs text-muted2 normal-case">Минимум {MIN_PASSWORD} символов. Другие устройства выйдут.</p>
			<button className="tb mt-3 font-bold" disabled={busy || !cur || !next || !again}>{busy ? 'Сохраняю…' : 'Сменить пароль'}</button>
			<p className="mt-3 min-h-5 text-bad" role="alert">{error && `!! ${error}`}</p>
		</form>
	)
}
