'use client'

import { useEffect, useState } from 'react'
import { useTracker } from '../TrackerProvider'

type State = 'loading' | 'unsupported' | 'ios-install' | 'off-server' | 'denied' | 'on' | 'off'

/** VAPID-ключ base64url → байты для pushManager.subscribe */
const keyBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

/** Push на этом устройстве: включить, проверить, выключить. На iPhone — только у приложения с экрана «Домой» */
export function Notifications() {
	const { toast, offline } = useTracker()
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

	return (
		<div className="uppercase">
			{state === 'loading' && <p className="text-muted">…</p>}
			{state === 'ios-install' && <p className="text-muted">На iPhone: «Поделиться → На экран „Домой“», затем откройте приложение с экрана</p>}
			{state === 'unsupported' && <p className="text-muted">Браузер не поддерживает уведомления</p>}
			{state === 'off-server' && <p className="text-muted">Не настроены на сервере</p>}
			{state === 'denied' && <p className="text-muted">Запрещены в настройках браузера</p>}
			{(state === 'on' || state === 'off') && (
				<div className="flex flex-wrap items-center gap-2">
					<span className="mr-2">{state === 'on' ? 'Включены на этом устройстве' : 'Выключены'}</span>
					{state === 'off' && <button className="tb" disabled={busy || !!offline} onClick={() => void enable()}>Включить</button>}
					{state === 'on' && (
						<>
							<button className="tb" disabled={!!offline} onClick={() => void test()}>Тест</button>
							<button className="tb" disabled={busy || !!offline} onClick={() => void disable()}>Выключить</button>
						</>
					)}
				</div>
			)}
			<p className="mt-2 text-muted2">// Обновления приложения, план на следующий месяц за 2 дня до конца, по воскресеньям — внести траты</p>
		</div>
	)
}
