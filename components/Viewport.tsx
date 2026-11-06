'use client'

import { useEffect, useState } from 'react'

/**
 * Страховки каркаса (корень — #page, position: fixed; inset: 0):
 * 1. Документ не прокручивается никогда: window scroll → scrollTo(0, 0).
 * 2. Только установленное PWA (standalone), портрет: если измерено innerHeight < screen.height, низ видимой
 *    области уже выше зоны полоски «домой» — нижний отступ панели (--nav-pb) уменьшается на это расхождение,
 *    иначе подписи вкладок уходят под край. В браузере и без расхождения ничего не меняется.
 * 3. ?debug=layout — размеры видимой области и корня в углу экрана (временная отладка).
 */
export function Viewport() {
	useEffect(() => {
		const root = document.documentElement
		const onScroll = () => {
			if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
		}
		const fit = () => {
			const standalone = matchMedia('(display-mode: standalone)').matches
			const portrait = window.innerHeight > window.innerWidth
			const gap = screen.height - window.innerHeight
			if (standalone && portrait && gap > 0) {
				const sab = parseFloat(getComputedStyle(root).getPropertyValue('--sab')) || 0
				root.style.setProperty('--nav-pb', `${Math.max(0, sab - gap)}px`)
			} else root.style.removeProperty('--nav-pb')
		}
		fit()
		window.addEventListener('scroll', onScroll, { passive: true })
		window.addEventListener('resize', fit)
		window.addEventListener('orientationchange', fit)
		return () => {
			window.removeEventListener('scroll', onScroll)
			window.removeEventListener('resize', fit)
			window.removeEventListener('orientationchange', fit)
		}
	}, [])

	const [debug, setDebug] = useState(false)
	useEffect(() => setDebug(new URLSearchParams(location.search).get('debug') === 'layout'), [])
	return debug ? <LayoutDebug /> : null
}

// ponytail: временная отладка — удалить вместе с ?debug=layout, когда прыжок на iPhone подтверждённо исчезнет
function LayoutDebug() {
	const [text, setText] = useState('')
	useEffect(() => {
		const r = (id: string) => {
			const b = document.getElementById(id)?.getBoundingClientRect()
			return b ? `top ${Math.round(b.top)} bottom ${Math.round(b.bottom)} h ${Math.round(b.height)}` : '—'
		}
		const read = () => {
			const vv = window.visualViewport
			const sheet = document.querySelector('[data-entry-sheet], [role="dialog"]') ? 'открыта' : 'закрыта'
			setText(
				[
					`шторка: ${sheet}`,
					`innerHeight ${window.innerHeight} · screen.height ${screen.height}`,
					`vv.height ${vv ? Math.round(vv.height) : '—'} · vv.offsetTop ${vv ? Math.round(vv.offsetTop) : '—'}`,
					`scrollY ${window.scrollY} · clientHeight ${document.documentElement.clientHeight}`,
					`--nav-pb ${document.documentElement.style.getPropertyValue('--nav-pb') || 'нет'}`,
					`#page ${r('page')}`,
					`#app-scroll ${r('app-scroll')}`,
				].join('\n'),
			)
		}
		read()
		const id = setInterval(read, 250)
		return () => clearInterval(id)
	}, [])
	return (
		<pre className="pointer-events-none fixed top-[env(safe-area-inset-top,0px)] right-0 z-[100] bg-ink/85 p-1.5 text-[0.625rem] leading-tight whitespace-pre text-panel">
			{text}
		</pre>
	)
}
