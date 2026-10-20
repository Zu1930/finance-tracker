'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useTracker } from './TrackerProvider'
import { Setup } from './Setup'
import { Migration } from './Migration'
import { useDailyRates } from './useDailyRates'
import { ThemeToggle } from './settings/ThemeSwitch'
import { catsIn, curMonthKey, fmt, minus, monthTitle } from '@/lib/utils'
import type { Category, Expense, PlanItem, TrackerData } from '@/lib/types'
import { abbr, monthExpense } from '@/lib/metrics'
import { planSpentByCat } from '@/lib/plan'

const TABS = [
	{ href: '/', label: 'Ввод' },
	{ href: '/limits', label: 'Лимиты' },
	{ href: '/savings', label: 'Сбережения' },
	{ href: '/chart', label: 'График' }
]

/** Остаток по лимитам (семья и мои личные), средний расход семьи в день и номер дня — для полосы метрик */
function MetricsBar({ data }: { data: TrackerData }) {
	const st = data.settings!
	const key = curMonthKey()
	// Лимиты месяца с поправками плана; траты по плану в остаток не входят, кроме превышения пункта
	const plan = data.plans[key]
	const left = (all: Category[], list: Expense[], items: PlanItem[], ov?: Record<string, number>) => {
		const spent = planSpentByCat(list, items)
		return catsIn(all, key, spent, ov).filter((c) => !c.archived).reduce((a, c) => a + c.limit - (spent[c.id] ?? 0), 0)
	}
	const family = left(st.familyCategories, data.familyExpenses[key] ?? [], plan?.items.family ?? [], plan?.familyOverrides)
	const mine = left(data.mySettings.personalCategories, data.myExpenses[key] ?? [], plan?.items.mine ?? [], plan?.myOverrides)
	const now = new Date()
	const day = now.getDate()
	const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
	// Темп — по всей семье: семейные, мои личные и личные суммы партнёра. Первые 3 дня — мало данных, как у прогноза
	const pace = day > 3 ? monthExpense(data, key) / day : null
	const paceText = pace === null ? '—' : fmt(Math.abs(pace) >= 100 ? Math.round(pace) : pace)
	const val = (n: number) => (
		<b className={n < 0 ? 'text-bad' : 'text-ink'}>
			{fmt(n)} {st.base}
		</b>
	)

	return (
		<>
			{/* Мобильный: два числа крупно, ниже одна строка — месяц, темп и валюта один раз */}
			<div className="border-y border-dashed border-line py-3 uppercase sm:hidden">
				<dl className="grid grid-cols-2 gap-x-4">
					{[['Остаток · семья', family], ['Остаток · моё', mine]].map(([label, n]) => (
						<div key={label as string} className="min-w-0">
							<dt className="text-xs text-muted">{label}</dt>
							<dd className={`text-xl font-bold whitespace-nowrap ${(n as number) < 0 ? 'text-bad' : ''}`}>{fmt(n as number)}</dd>
						</div>
					))}
				</dl>
				<p className="mt-2 text-xs text-muted">
					{abbr(key)} {day}/{days} · Темп {paceText}{pace !== null && '/день'} · {st.base}
				</p>
			</div>
			<div className="hidden flex-wrap justify-between gap-x-6 gap-y-1 border-y border-dashed border-line py-3 text-muted uppercase sm:flex">
				<span>
					[ Остаток: семья {val(family)} // моё {val(mine)} ]
				</span>
				<span>
					[ ТЕМП:{' '}
					<b className="text-ink">{pace === null ? '—' : `${minus(Math.abs(pace) >= 100 ? Math.round(pace) : pace)} ${st.base}/ДЕНЬ`}</b>{' '}
					]
				</span>
				<span>
					[ {monthTitle(key)} // ДЕНЬ {day}/{days} ]
				</span>
			</div>
		</>
	)
}

export function Shell({ children }: { children: ReactNode }) {
	const pathname = usePathname()
	const { status, data, reload, toastState, dismissToast, offline, queued } = useTracker()
	useDailyRates()
	const router = useRouter()

	// Ctrl + , (⌘ + , на macOS) — настройки. В полях ввода не перехватываем
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.key !== ',') return
			const el = e.target as HTMLElement | null
			if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
			e.preventDefault()
			router.push('/settings')
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [router])

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
	else if (!data.settings) body = data.migration ? <Migration /> : <Setup />
	else body = children

	const tabs = (mobile: boolean) =>
		TABS.map((t) => (
			<Link
				key={t.href}
				href={t.href}
				className={mobile ? 'mbare tbox h-[calc(52px+env(safe-area-inset-bottom,0px))] justify-center border-0 px-0 pb-[env(safe-area-inset-bottom,0px)] text-xs not-first:border-l not-first:border-line aria-[current=page]:border-ink' : 'tb'}
				aria-current={pathname === t.href ? 'page' : undefined}
			>
				{t.label}
			</Link>
		))

	return (
		// Мобильный: колонка на всю высоту экрана, нижняя панель вкладок прилипает к низу
		<div className="mx-auto flex min-h-dvh max-w-280 flex-col sm:block sm:min-h-0">
			<div className="flex-1 px-4 pt-5 pb-6 sm:px-12 sm:pb-10">
				<header className="flex flex-nowrap items-center gap-x-6 gap-y-3 pb-4 sm:flex-wrap">
					<div className="mr-auto min-w-0">
						<b className="lowercase sm:hidden">&gt; spend.log</b>
						<div className="lbl hidden sm:block">
							SPEND.LOG // BASE: <b className="text-ink">{data.settings?.base ?? '—'}</b>
						</div>
					</div>
					<nav className="hidden flex-wrap gap-2 sm:flex" aria-label="Разделы">
						{tabs(false)}
					</nav>
					{/* Тема и настройки — отдельно от вкладок, справа */}
					<div className="flex shrink-0 items-center gap-2">
						<ThemeToggle />
						<Link
							href="/settings"
							className="tb h-10 text-muted sm:h-auto"
							aria-label="Настройки"
							title="Настройки (Ctrl + ,)"
							aria-current={pathname === '/settings' ? 'page' : undefined}
						>
							CFG
						</Link>
					</div>
				</header>
				{status === 'ready' && data.settings ? (
					<MetricsBar data={data} />
				) : (
					<hr className="dash" />
				)}
				{(offline || queued > 0) && (
					<p className="mt-3 text-warn uppercase" role="status">
						{offline ? '!! Нет связи' : '> Отправка'}
						{offline?.savedAt && ` // данные на ${new Date(offline.savedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
						{queued > 0 && ` // в очереди: ${queued}`}
					</p>
				)}
				<main className="pt-6">{body}</main>
			</div>
			<nav
				className="sticky bottom-0 z-10 grid grid-cols-4 border-t border-line bg-panel sm:hidden"
				aria-label="Разделы"
			>
				{tabs(true)}
			</nav>
			{toastState && (
				<div
					role="status"
					key={toastState.id}
					// Мобильный: над нижней панелью (52px + 12px + safe-area), на всю ширину минус поля
					className="fixed inset-x-4 bottom-[calc(64px+env(safe-area-inset-bottom,0px))] z-20 flex flex-wrap items-center gap-x-6 gap-y-1 bg-ink px-4 py-2 text-panel uppercase sm:inset-x-auto sm:bottom-[calc(16px+env(safe-area-inset-bottom,0px))] sm:left-1/2 sm:w-max sm:max-w-[calc(100%-32px)] sm:-translate-x-1/2"
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
