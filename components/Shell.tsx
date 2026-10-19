'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useTracker } from './TrackerProvider'
import { Setup } from './Setup'
import { Migration } from './Migration'
import { useDailyRates } from './useDailyRates'
import { ThemeToggle } from './settings/ThemeSwitch'
import {
	activeCats,
	liveCats,
	curMonthKey,
	fmt,
	monthTitle,
	spentByCat
} from '@/lib/utils'
import type { Category, Expense, TrackerData } from '@/lib/types'
import { monthExpense } from '@/lib/metrics'

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
	const left = (cats: Category[], list: Expense[]) => {
		const spent = spentByCat(list)
		return cats.reduce((a, c) => a + c.limit - (spent[c.id] ?? 0), 0)
	}
	const family = left(activeCats(st), data.familyExpenses[key] ?? [])
	const mine = left(liveCats(data.mySettings.personalCategories), data.myExpenses[key] ?? [])
	const now = new Date()
	const day = now.getDate()
	const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
	// Темп — по всей семье: семейные, мои личные и личные суммы партнёра
	const pace = monthExpense(data, key) / day
	const val = (n: number) => (
		<b className={n < 0 ? 'text-bad' : 'text-ink'}>
			{fmt(n)} {st.base}
		</b>
	)

	return (
		<div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-y border-dashed border-line py-3 text-muted uppercase">
			<span>
				[ Остаток: семья {val(family)} // моё {val(mine)} ]
			</span>
			<span>
				[ ТЕМП:{' '}
				<b className="text-ink">
					−{fmt(Math.abs(pace) >= 100 ? Math.round(pace) : pace)} {st.base}/ДЕНЬ
				</b>{' '}
				]
			</span>
			<span>
				[ {monthTitle(key)} // ДЕНЬ {day}/{days} ]
			</span>
		</div>
	)
}

export function Shell({ children }: { children: ReactNode }) {
	const pathname = usePathname()
	const { status, data, reload, toastState, dismissToast } = useTracker()
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

	return (
		<div className="mx-auto max-w-280">
			<div className="px-4 pt-3 pb-6 sm:px-12 sm:pt-5 sm:pb-10">
				<header className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-4">
					<div className="mr-auto flex items-center gap-4">
						<div className="lbl">
							SPEND.LOG // BASE:{' '}
							<b className="text-ink">{data.settings?.base ?? '—'}</b>
						</div>
						<ThemeToggle />
					</div>
					{/* На мобильном вкладки уходят на вторую строку, а ⚙ остаётся в первой */}
					<nav
						className="flex flex-wrap gap-2 max-sm:order-last max-sm:w-full"
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
					</nav>
					<Link
						href="/settings"
						className="tb text-muted"
						aria-label="Настройки"
						title="Настройки (Ctrl + ,)"
						aria-current={pathname === '/settings' ? 'page' : undefined}
					>
						CFG
					</Link>
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
