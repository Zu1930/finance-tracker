'use client'

import { useRef, useState } from 'react'
import { SW_CACHE } from '@/lib/offline'

const logout = async () => {
	await fetch('/api/logout', { method: 'POST' })
	// Офлайн-копия данных и очередь — этого пользователя: на общем устройстве их не должен увидеть следующий
	try {
		await caches.delete(SW_CACHE)
		Object.keys(localStorage).filter((k) => k.startsWith('ft:queue:')).forEach((k) => localStorage.removeItem(k))
	} catch {}
	window.location.href = '/login'
}

const HOLD_MS = 1200

/** Выход по удержанию: кнопка заливается красным, отпустил раньше — отмена */
export function HoldLogout() {
	const [holding, setHolding] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const keyHold = useRef(false)

	const start = () => {
		clearTimeout(timer.current)
		setHolding(true)
		timer.current = setTimeout(logout, HOLD_MS)
	}
	const cancel = () => {
		clearTimeout(timer.current)
		setHolding(false)
	}

	return (
		<button
			className="tb relative overflow-hidden select-none [-webkit-touch-callout:none]"
			aria-label="Выйти, удерживайте"
			onPointerDown={(e) => {
				if (e.button === 0) start()
			}}
			onPointerUp={cancel}
			onPointerLeave={cancel}
			onPointerCancel={cancel}
			onContextMenu={(e) => e.preventDefault()}
			onKeyDown={(e) => {
				if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
					e.preventDefault()
					keyHold.current = true
					start()
				}
			}}
			onKeyUp={(e) => {
				if (e.key === ' ' || e.key === 'Enter') {
					cancel()
					setTimeout(() => (keyHold.current = false))
				}
			}}
			// Скринридер активирует кнопку кликом без нажатия — удерживать там нечем, выходим сразу
			onClick={(e) => {
				if (e.detail === 0 && !keyHold.current) logout()
			}}
		>
			Выйти
			<span
				aria-hidden="true"
				className={`absolute inset-0 flex items-center justify-center bg-bad font-bold text-panel transition-[clip-path] ${holding ? 'ease-linear [clip-path:inset(0_0_0_0)]' : '[clip-path:inset(0_100%_0_0)]'}`}
				style={{ transitionDuration: holding ? `${HOLD_MS}ms` : '200ms' }}
			>
				[&nbsp;ВЫЙТИ&nbsp;]
			</span>
		</button>
	)
}
