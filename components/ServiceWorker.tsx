'use client'

import { useEffect } from 'react'

/** Регистрирует public/sw.js: офлайн-просмотр и push. В dev не мешаем горячей перезагрузке */
export function ServiceWorker() {
	useEffect(() => {
		if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
		navigator.serviceWorker.register('/sw.js').catch(() => {})
	}, [])
	return null
}
