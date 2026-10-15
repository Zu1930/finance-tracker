'use client'

import { useEffect, useState } from 'react'

/** Ключ должен совпадать со скриптом в app/layout.tsx, который ставит тему до гидрации */
const THEME_KEY = 'ft:theme'
const THEMES = [
	{ id: 'auto', label: 'Авто' },
	{ id: 'dark', label: 'Тёмная' },
	{ id: 'light', label: 'Светлая' }
] as const
type Theme = (typeof THEMES)[number]['id']

/** АВТО — без data-theme, тема по системе; ТЁМНАЯ/СВЕТЛАЯ — data-theme на <html> */
export function ThemeSwitch() {
	const [theme, setTheme] = useState<Theme>('auto')
	useEffect(() => {
		const t = document.documentElement.dataset.theme
		if (t === 'light' || t === 'dark') setTheme(t)
	}, [])

	const choose = (t: Theme) => {
		setTheme(t)
		const root = document.documentElement
		if (t === 'auto') delete root.dataset.theme
		else root.dataset.theme = t
		try {
			if (t === 'auto') localStorage.removeItem(THEME_KEY)
			else localStorage.setItem(THEME_KEY, t)
		} catch {}
	}

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
					onClick={() => choose(t.id)}
				>
					{t.label}
				</button>
			))}
		</div>
	)
}
