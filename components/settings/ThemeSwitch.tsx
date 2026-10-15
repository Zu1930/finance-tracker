'use client'

import { useSyncExternalStore } from 'react'

/** Ключ должен совпадать со скриптом в app/layout.tsx, который ставит тему до гидрации */
const THEME_KEY = 'ft:theme'
type Theme = 'auto' | 'dark' | 'light'
const THEMES: { id: Theme; label: string; spoken: string }[] = [
	{ id: 'auto', label: 'Auto', spoken: 'как в системе' },
	{ id: 'dark', label: 'Dark', spoken: 'тёмная' },
	{ id: 'light', label: 'Light', spoken: 'светлая' }
]

// Источник правды — атрибут data-theme на <html>: все переключатели на странице видят одно и то же
const subscribe = (cb: () => void) => {
	const obs = new MutationObserver(cb)
	obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
	return () => obs.disconnect()
}
const read = (): Theme => {
	const t = document.documentElement.dataset.theme
	return t === 'dark' || t === 'light' ? t : 'auto'
}
const useTheme = () => useSyncExternalStore(subscribe, read, () => 'auto' as Theme)

/** АВТО — без data-theme, тема по системе; ТЁМНАЯ/СВЕТЛАЯ — data-theme на <html> и в localStorage */
function setTheme(t: Theme) {
	const root = document.documentElement
	if (t === 'auto') delete root.dataset.theme
	else root.dataset.theme = t
	try {
		if (t === 'auto') localStorage.removeItem(THEME_KEY)
		else localStorage.setItem(THEME_KEY, t)
	} catch {}
}

/** Три кнопки в настройках */
export function ThemeSwitch() {
	const theme = useTheme()
	return (
		<div
			className="flex flex-wrap gap-2"
			role="group"
			aria-label="Тема оформления"
		>
			{THEMES.map((t) => (
				<button
					key={t.id}
					className="tb"
					aria-pressed={theme === t.id}
					onClick={() => setTheme(t.id)}
				>
					{t.label}
				</button>
			))}
		</div>
	)
}

/** Кнопка в шапке: по кругу AUTO → DARK → LIGHT. Ширина фиксирована под самую длинную надпись, чтобы шапка не прыгала */
export function ThemeToggle() {
	const theme = useTheme()
	const i = THEMES.findIndex((t) => t.id === theme)
	const cur = THEMES[i], next = THEMES[(i + 1) % THEMES.length]
	return (
		<button
			className="tb w-[11ch] text-muted hover:text-ink"
			onClick={() => setTheme(next.id)}
			aria-label={`Тема: ${cur.spoken}. Переключить на: ${next.spoken}`}
			title={`Тема: ${cur.spoken} → ${next.spoken}`}
		>
			{cur.label}
		</button>
	)
}
