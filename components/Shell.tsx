'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Suspense, useEffect, type ReactNode } from 'react'
import { useTracker } from './TrackerProvider'
import { SpaceProvider, useSpace } from './SpaceProvider'
import { SpaceSwitcher } from './SpaceSwitcher'
import { CommandPalette, Shortcuts, useHotkeyDialogs } from './CommandPalette'
import { Setup } from './Setup'
import { useDailyRates } from './useDailyRates'
import { ThemeToggle } from './settings/ThemeSwitch'
import { needsWelcome } from '@/lib/onboarding'
import { HintsProvider } from './onboarding/Hint'
import { EntrySheetHost } from './entry/MobileEntry'
import { Icon } from './icons/Icon'
import { Problem } from './icons/IconText'
import type { IconName } from './icons/icons'
import { t } from '@/lib/i18n'
import { isMac } from '@/lib/utils'

const TABS: { href: string; label: string; icon?: IconName }[] = [
	{ href: '/', label: t('nav.entry'), icon: 'plus' },
	{ href: '/limits', label: t('nav.limits'), icon: 'limits' },
	{ href: '/savings', label: t('nav.money'), icon: 'money' },
	{ href: '/summary', label: t('nav.summary'), icon: 'chart' }
]
/** Мобильный: лента вместо ввода, «Деньги» — сбережения; по центру — кнопка «+» */
const MOBILE_TABS: { href: string; label: string; icon?: IconName }[] = [
	{ href: '/', label: t('nav.feed'), icon: 'feed' },
	{ href: '/limits', label: t('nav.limits'), icon: 'limits' },
	{ href: '/savings', label: t('nav.money'), icon: 'money' },
	{ href: '/summary', label: t('nav.summary'), icon: 'chart' }
]

/** Бюджет выбирается один раз для всего экрана: контекст — над шапкой, лентой и формой */
export function Shell({ children }: { children: ReactNode }) {
	return (
		<SpaceProvider>
			<ShellBody>{children}</ShellBody>
		</SpaceProvider>
	)
}

function ShellBody({ children }: { children: ReactNode }) {
	const pathname = usePathname()
	const { status, data, reload, toastState, dismissToast, offline, queued, patchOnboarding } = useTracker()
	const { switchable } = useSpace()
	useDailyRates()
	const router = useRouter()
	// Семья распущена, разбор ещё не пройден — экран «Общий бюджет больше не активен» (его можно пропустить)
	const review = data.pendingReview?.householdId
	useEffect(() => {
		if (review && !data.readonly) router.replace(`/review/${review}`)
	}, [review, data.readonly, router])
	// Открыто с экрана «Домой» (standalone) — пункт «Приложение на телефоне» в карточке «Настройка» выполнен
	const pwaSeen = data.onboarding?.pwaSeen
	useEffect(() => {
		if (status !== 'ready' || pwaSeen !== false) return
		const standalone = matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone
		if (standalone) patchOnboarding({ pwa: true })
	}, [status, pwaSeen, patchOnboarding])

	// Опрос-настройка ещё не пройден — на /welcome
	const welcome = needsWelcome(data, pathname)
	useEffect(() => {
		if (status === 'ready' && welcome) window.location.replace('/welcome')
	}, [status, welcome])

	// Ctrl + , (⌘ + , на macOS) — настройки, ? — горячие клавиши, ⌘/Ctrl + K — палитра. В полях ввода не перехватываем
	const dialogs = useHotkeyDialogs()
	const { setOpen: setDialog } = dialogs
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const help = e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey
			if (!help && (!(e.ctrlKey || e.metaKey) || e.key !== ',')) return
			const el = e.target as HTMLElement | null
			if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
			e.preventDefault()
			if (help) setDialog('keys')
			else router.push('/settings')
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [router, setDialog])

	let body: ReactNode
	if (status === 'loading')
		body = <p className="py-16 text-center text-muted">&gt; ЗАГРУЗКА ДАННЫХ…</p>
	else if (status === 'error')
		body = (
			<div className="py-8">
				<p className="mb-4 text-bad">
					!! НЕ УДАЛОСЬ ЗАГРУЗИТЬ ДАННЫЕ. ПРОВЕРЬТЕ СВЯЗЬ И ПОВТОРИТЕ
				</p>
				<button
					className="tb"
					onClick={() => void reload()}
				>
					Повторить
				</button>
			</div>
		)
	else if (welcome) body = <p className="py-16 text-center text-muted">&gt; НАСТРОЙКА…</p>
	else if (!data.settings && !pathname.startsWith('/help')) body = <Setup />
	else body = children

	// Архив: свои вкладки внутри /archive/<id>, только чтение
	const ro = data.readonly
	const base = ro ? `/archive/${ro.householdId}` : ''
	const shown = ro ? [{ href: base, label: 'Лимиты' }, { href: `${base}/summary`, label: t('nav.summary') }, { href: `${base}/logs`, label: 'Логи' }, { href: '/settings/data', label: '← Выход' }] : TABS
	const tabs = (mobile: boolean) =>
		(mobile && !ro ? MOBILE_TABS : (shown as typeof MOBILE_TABS)).map((tab) => (
			<Link
				key={tab.href}
				href={tab.href}
				className={
					mobile
						? 'flex min-h-[3.25rem] flex-col items-center justify-center gap-1 border-t-2 border-transparent py-1.5 text-[0.6875rem] text-muted uppercase aria-[current=page]:border-ink aria-[current=page]:font-bold aria-[current=page]:text-ink'
						: 'tbox min-h-10 gap-2 px-3 text-muted uppercase aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:font-bold aria-[current=page]:text-panel'
				}
				aria-current={pathname === tab.href ? 'page' : undefined}
			>
				{tab.icon && <Icon name={tab.icon} size={mobile ? 20 : 16} />}
				{tab.label}
			</Link>
		))
	const ready = status === 'ready' && !!data.settings && !ro

	return (
		// Мобильный: колонка на всю высоту экрана, нижняя панель вкладок прилипает к низу.
		// Десктоп: панель 1120 → 1440 (wide) → 1840 (huge) → 2200 (giant), в px — не растёт с масштабом шрифта; поля страницы 24 / 32 / 40
		<div className="xl:px-6 wide:px-8 huge:px-10">
		<div className="mx-auto flex min-h-dvh max-w-280 flex-col sm:block sm:min-h-0 wide:max-w-[1440px] huge:max-w-[1840px] giant:max-w-[2200px]">
			<div className="flex-1 px-4 pt-5 pb-6 sm:px-12 sm:pb-10">
				<header className="flex flex-nowrap items-center gap-x-6 gap-y-3 pb-4 sm:flex-wrap">
					<div className="mr-auto min-w-0 sm:mr-0">
						{/* Бюджет — слева; без выбора (solo, архив) — название приложения */}
						{switchable && ready ? (
							<SpaceSwitcher />
						) : (
							<>
								<b className="lowercase sm:hidden">&gt; spend.log</b>
								<div className="lbl hidden sm:block">
									SPEND.LOG // BASE: <b className="text-ink">{data.settings?.base ?? '—'}</b>
								</div>
							</>
						)}
						{ro && (
							<p className="text-warn uppercase">
								// Архив, только чтение · данные до {new Date(ro.leftAt).toLocaleDateString('ru-RU')} · доступен до {new Date(ro.until).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
							</p>
						)}
					</div>
					<nav className="hidden flex-wrap gap-1 sm:flex" aria-label="Разделы">
						{tabs(false)}
					</nav>
					{/* Палитра, помощь, тема и настройки — отдельно от вкладок, справа */}
					<div className="flex shrink-0 items-center gap-2 sm:ml-auto">
						{ready && (
							<button className="tbox min-h-10 justify-between gap-2.5 px-3 text-muted max-lg:hidden lg:min-w-[13.75rem]" onClick={() => setDialog('palette')}>
								<Icon name="search" size={16} />
								<span>{t('palette.open')}</span>
								<kbd className="kbd">{isMac() ? '⌘ K' : 'Ctrl K'}</kbd>
							</button>
						)}
						<Link
							href="/help"
							className="ib aria-[current=page]:text-ink"
							title={`${t('nav.help')} (?)`}
							aria-current={pathname.startsWith('/help') ? 'page' : undefined}
						>
							<Icon name="help" size={20} label={t('nav.help')} />
						</Link>
						{/* Мобильный: тема — в настройках, в шапке только помощь и настройки */}
						<span className="max-sm:hidden"><ThemeToggle /></span>
						<Link
							href="/settings"
							className="ib aria-[current=page]:text-ink"
							title={`${t('nav.settings')} (Ctrl + ,)`}
							aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
						>
							<Icon name="settings" size={20} label={t('nav.settings')} />
						</Link>
					</div>
				</header>
				{/* Итог бюджета: на десктопе — колонка рядом с лентой, на мобильном — верх ленты */}
				<hr className={`dash ${ready ? 'max-sm:hidden' : ''}`} />
				{(offline || queued > 0) && (
					<p className="mt-3 text-warn uppercase" role="status">
						{offline ? <Icon name="warning" size={16} className="mr-2" /> : null}
						{offline ? t('app.offline') : '> Отправка'}
						{offline?.savedAt && ` // данные на ${new Date(offline.savedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
						{queued > 0 && ` // в очереди: ${queued}`}
					</p>
				)}
				<main className="pt-6"><HintsProvider>{body}</HintsProvider></main>
			</div>
			<nav
				className={`sticky bottom-0 z-10 grid items-end border-t border-line bg-panel pb-[env(safe-area-inset-bottom,0rem)] sm:hidden ${ro || !ready ? 'grid-cols-4' : 'grid-cols-[1fr_1fr_5.25rem_1fr_1fr]'}`}
				aria-label="Разделы"
			>
				{ro || !ready ? tabs(true) : (
					<>
						{tabs(true).slice(0, 2)}
						{/* useSearchParams внутри — нужна граница Suspense */}
						<Suspense fallback={<span />}><EntrySheetHost /></Suspense>
						{tabs(true).slice(2)}
					</>
				)}
			</nav>
			{ready && dialogs.open === 'palette' && <CommandPalette onClose={() => setDialog(null)} />}
			{dialogs.open === 'keys' && <Shortcuts onClose={() => setDialog(null)} />}
			{toastState && (
				<div
					role="status"
					key={toastState.id}
					data-toast
					// Мобильный: над нижней панелью и кнопкой «+» (52px + 26px + отступ + safe-area), на всю ширину минус поля
					className="fixed inset-x-4 bottom-[calc(5.75rem+env(safe-area-inset-bottom,0rem))] z-50 flex flex-wrap items-center gap-x-6 gap-y-1 bg-ink px-4 py-2 text-panel uppercase sm:inset-x-auto sm:bottom-[calc(1rem+env(safe-area-inset-bottom,0rem))] sm:left-1/2 sm:w-max sm:max-w-[calc(100%-2rem)] sm:-translate-x-1/2"
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
		</div>
	)
}
