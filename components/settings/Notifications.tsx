'use client'

import { useEffect, useState } from 'react'
import { useTracker } from '../TrackerProvider'
import { SettingsRow } from './Kit'
import { DEFAULT_REMINDERS } from '@/lib/push'
import type { Reminders } from '@/lib/types'

type State = 'loading' | 'unsupported' | 'ios-install' | 'off-server' | 'denied' | 'on' | 'off'

/** VAPID-ключ base64url → байты для pushManager.subscribe */
const keyBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

/** Push на этом устройстве: включить, проверить, выключить. На iPhone — только у приложения с экрана «Домой» */
export function Notifications() {
	const { toast, offline, data, setMySettings } = useTracker()
	const [state, setState] = useState<State>('loading')
	const [busy, setBusy] = useState(false)

	const check = async () => {
		if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
			const ios = /iP(hone|ad|od)/.test(navigator.userAgent)
			const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches
			return setState(ios && !standalone ? 'ios-install' : 'unsupported')
		}
		if (Notification.permission === 'denied') return setState('denied')
		const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
		const res = await fetch(`/api/push${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''}`)
		if (res.status === 404) return setState('off-server')
		const j = (await res.json()) as { subscribed: boolean }
		setState(sub && j.subscribed ? 'on' : 'off')
	}
	useEffect(() => {
		check().catch(() => setState('unsupported'))
	}, [])

	const enable = async () => {
		setBusy(true)
		try {
			// Разрешение — только по нажатию: иначе Safari на iPhone откажет
			if ((await Notification.requestPermission()) !== 'granted') return void setState('denied')
			const { publicKey } = (await (await fetch('/api/push')).json()) as { publicKey: string }
			const reg = await navigator.serviceWorker.ready
			const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
			const res = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })
			if (!res.ok) throw new Error()
			setState('on')
			// Напоминания — по времени этого устройства, даже если расписание не меняли
			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
			const r = data.mySettings.reminders ?? DEFAULT_REMINDERS
			if (r.tz !== tz) setMySettings(({ version: _, ...rest }) => ({ ...rest, reminders: { ...r, tz } }))
			toast('Уведомления включены')
		} catch {
			toast('Не удалось включить уведомления.')
		} finally {
			setBusy(false)
		}
	}
	const disable = async () => {
		setBusy(true)
		try {
			const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
			if (sub) {
				await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
				await sub.unsubscribe()
			}
			setState('off')
		} finally {
			setBusy(false)
		}
	}
	const test = async () => {
		const j = (await (await fetch('/api/push/test', { method: 'POST' })).json().catch(() => ({ sent: 0 }))) as { sent: number }
		toast(j.sent ? 'Отправлено' : 'Не доставлено — включите уведомления заново')
	}

	const status = {
		loading: '…',
		'ios-install': 'На iPhone — только у приложения с экрана «Домой»',
		unsupported: 'Браузер не поддерживает уведомления',
		'off-server': 'Не настроены на сервере',
		denied: 'Запрещены в настройках браузера',
		on: 'Включены на этом устройстве',
		off: 'Выключены',
	}[state]
	return (
		<div>
			<SettingsRow className="uppercase" end={
				state === 'off' ? <button className="tb" disabled={busy || !!offline} onClick={() => void enable()}>Включить</button>
				: state === 'on' ? (
					<>
						<button className="tb" disabled={!!offline} onClick={() => void test()}>Тест</button>
						<button className="tb" disabled={busy || !!offline} onClick={() => void disable()}>Выключить</button>
					</>
				)
				: state === 'ios-install' ? <span className="text-xs text-muted normal-case">Поделиться → На экран «Домой»</span>
				: undefined
			}>
				<span className={state === 'on' ? '' : 'text-muted'}>{status}</span>
			</SettingsRow>
			<ReminderTimes />
		</div>
	)
}

const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const WEEK = [1, 2, 3, 4, 5, 6, 0]

/** Когда присылать напоминания — для всех устройств пользователя (личные настройки) */
function ReminderTimes() {
	const { data, setMySettings } = useTracker()
	const r = data.mySettings.reminders ?? DEFAULT_REMINDERS
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
	// Любое изменение запоминает пояс этого устройства: в нём сервер и считает час и день
	const set = (patch: Partial<Reminders>) => setMySettings(({ version: _, ...rest }) => ({ ...rest, reminders: { ...r, ...patch, tz } }))
	const pick = (label: string, value: number, options: [number, string][], onChange: (v: number) => void) => (
		<SettingsRow end={
			<select className="tfield cursor-pointer bg-panel" aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
				{options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
			</select>
		}>
			{label}
		</SettingsRow>
	)
	return (
		<div className="mt-4">
			{pick('Время', r.hour, Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, '0')}:00`]), (hour) => set({ hour }))}
			{pick('Внести траты', r.weekday, WEEK.map((d) => [d, DAYS[d]]), (weekday) => set({ weekday }))}
			{pick('План месяца', r.planDays, [1, 2, 3, 4, 5].map((n) => [n, `за ${n} ${n === 1 ? 'день' : n < 5 ? 'дня' : 'дней'}`]), (planDays) => set({ planDays }))}
			<SettingsRow end={r.tz !== tz ? <button className="tb" onClick={() => set({})}>Взять с устройства</button> : undefined}>
				Часовой пояс <span className="text-muted">{r.tz ?? 'Europe/Belgrade'}</span>
			</SettingsRow>
			<p className="mt-2 text-xs text-muted2">План — до конца месяца, если его ещё нет. Расписание общее для всех ваших устройств; о новой версии приложения — сразу после обновления.</p>
		</div>
	)
}
