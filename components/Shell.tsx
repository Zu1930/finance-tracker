'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTracker } from './TrackerProvider'
import { Setup } from './Setup'
import {
	activeCats,
	curMonthKey,
	fmt,
	monthTitle,
	spentByCat
} from '@/lib/utils'
import type { TrackerData } from '@/lib/types'

const TABS = [
	{ href: '/', label: 'Ввод' },
	{ href: '/income', label: 'Зарплата' },
	{ href: '/limits', label: 'Лимиты' },
	{ href: '/goals', label: 'Копилки' },
	{ href: '/chart', label: 'График' }
]

/** Остаток по лимитам, средний расход в день и номер дня — для полосы метрик */
function MetricsBar({ data }: { data: TrackerData }) {
	const st = data.settings!
	const key = curMonthKey()
	const expenses = data.months[key]?.expenses ?? []
	const spent = spentByCat(expenses)
	const cats = activeCats(st)
	const left = cats.reduce((a, c) => a + c.limit - (spent[c.id] ?? 0), 0)
	const now = new Date()
	const day = now.getDate()
	const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
	const pace = expenses.reduce((a, e) => a + e.base, 0) / day

	return (
		<div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-y border-dashed border-line py-3 text-muted uppercase">
			<span>
				[ ОСТАТОК ПО ЛИМИТАМ:{' '}
				<b className={left < 0 ? 'text-bad' : 'text-ink'}>
					{fmt(left)} {st.base}
				</b>{' '}
				]
			</span>
			<span>
				[ ТЕМП:{' '}
				<b className="text-ink">
					−{fmt(Math.round(pace))} {st.base}/ДЕНЬ
				</b>{' '}
				]
			</span>
			<span>
				[ {monthTitle(key)} // ДЕНЬ {day}/{days} ]
			</span>
		</div>
	)
}

const THEME_KEY = 'ft:theme'
const THEMES = ['auto', 'light', 'dark'] as const
type Theme = (typeof THEMES)[number]

/** AUTO → LIGHT → DARK. AUTO — по системе: атрибута data-theme нет */
function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>('auto')
	useEffect(() => {
		const t = document.documentElement.dataset.theme
		if (t === 'light' || t === 'dark') setTheme(t)
	}, [])

	const next = () => {
		const t = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
		setTheme(t)
		const root = document.documentElement
		try {
			if (t === 'auto') {
				delete root.dataset.theme
				localStorage.removeItem(THEME_KEY)
			} else {
				root.dataset.theme = t
				localStorage.setItem(THEME_KEY, t)
			}
		} catch {}
	}

	return (
		<button
			className="tb"
			onClick={next}
			aria-label={`Тема: ${{ auto: 'как в системе', light: 'светлая', dark: 'тёмная' }[theme]}. Переключить`}
		>
			Theme: {theme}
		</button>
	)
}

const HOLD_MS = 1200

/** Выход по удержанию: кнопка заливается красным, отпустил раньше — отмена */
function HoldLogout({ onDone }: { onDone: () => void }) {
	const [holding, setHolding] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const keyHold = useRef(false)

	const start = () => {
		clearTimeout(timer.current)
		setHolding(true)
		timer.current = setTimeout(onDone, HOLD_MS)
	}
	const cancel = () => {
		clearTimeout(timer.current)
		setHolding(false)
	}

	return (
		<button
			className="tb relative overflow-hidden select-none [-webkit-touch-callout:none]"
			aria-label="Выход, удерживайте"
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
				if (e.detail === 0 && !keyHold.current) onDone()
			}}
		>
			Выход
			<span
				aria-hidden="true"
				className={`absolute inset-0 flex items-center justify-center bg-bad font-bold text-panel transition-[clip-path] ${holding ? 'ease-linear [clip-path:inset(0_0_0_0)]' : '[clip-path:inset(0_100%_0_0)]'}`}
				style={{ transitionDuration: holding ? `${HOLD_MS}ms` : '200ms' }}
			>
				[&nbsp;ВЫХОД&nbsp;]
			</span>
		</button>
	)
}

export function Shell({ children }: { children: ReactNode }) {
	const pathname = usePathname()
	const { status, data, reload, toastState, dismissToast } = useTracker()

	const logout = async () => {
		await fetch('/api/logout', { method: 'POST' })
		window.location.href = '/login'
	}

	let body: ReactNode
	if (status === 'loading')
		body = <p className="py-16 text-center text-muted">&gt; ЗАГРУЗКА ДАННЫХ…</p>
	else if (status === 'error')
		body = (
			<div className="py-8">
				<p className="mb-4 text-bad">
					!! НЕ УДАЛОСЬ ЗАГРУЗИТЬ ДАННЫЕ. ПРОВЕРЬТЕ ПОДКЛЮЧЕНИЕ К UPSTASH REDIS
					В НАСТРОЙКАХ VERCEL
				</p>
				<button
					className="tb"
					onClick={() => void reload()}
				>
					Повторить
				</button>
			</div>
		)
	else if (!data.settings) body = <Setup />
	else body = children

	return (
		<div className="mx-auto max-w-280">
			<div className="px-4 pt-3 pb-6 sm:px-12 sm:pt-5 sm:pb-10">
				<header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-4">
					<div className="flex items-center gap-4">
						<div className="lbl">
							SPEND.LOG // BASE:{' '}
							<b className="text-ink">{data.settings?.base ?? '—'}</b>
						</div>
						<ThemeToggle />
					</div>
					<nav
						className="flex flex-wrap gap-2"
						aria-label="Разделы"
					>
						{TABS.map((t) => (
							<Link
								key={t.href}
								href={t.href}
								className="tb"
								aria-current={pathname === t.href ? 'page' : undefined}
							>
								{t.label}
							</Link>
						))}
						<HoldLogout onDone={logout} />
					</nav>
				</header>
				{status === 'ready' && data.settings ? (
					<MetricsBar data={data} />
				) : (
					<hr className="dash" />
				)}
				<main className="pt-6">{body}</main>
			</div>
			{toastState && (
				<div
					role="status"
					key={toastState.id}
					className="fixed bottom-[calc(16px+env(safe-area-inset-bottom,0px))] left-1/2 z-20 max-sm:bottom-[calc(88px+env(safe-area-inset-bottom,0px))] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap items-center gap-x-6 gap-y-1 bg-ink px-4 py-2 text-panel uppercase"
				>
					<span>&gt; {toastState.msg}</span>
					{toastState.actionLabel && (
						<button
							className="brk min-h-11 px-1 font-bold uppercase hover:underline focus-visible:outline-panel"
							onClick={() => {
								dismissToast()
								toastState.action?.()
							}}
						>
							{toastState.actionLabel}
						</button>
					)}
				</div>
			)}
		</div>
	)
}
