'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTracker } from '../TrackerProvider'
import { useTheme } from './ThemeSwitch'
import { GROUPS, TITLES, settingsMeta, type MetaInput, type Section } from '@/lib/settings-meta'

export const LAST_SECTION_KEY = 'ft:settings-section'

/** Подписи состояния: то, чего нет в /api/data, догружается; обновляется при переходе между разделами */
function useMeta() {
	const { data } = useTracker()
	const theme = useTheme()
	const pathname = usePathname()
	const [x, setX] = useState<Omit<MetaInput, 'theme'>>({ members: null, tokens: null, archives: null, activeCodes: null, notifications: null })
	useEffect(() => {
		const get = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
		void Promise.all([
			get('/api/family'),
			get('/api/quick/tokens'),
			get('/api/archive'),
			data.admin ? get('/api/admin/signup-codes') : null,
			'serviceWorker' in navigator && 'PushManager' in window
				? navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => !!s && Notification.permission === 'granted').catch(() => false)
				: false,
		]).then(([family, tokens, archive, codes, notifications]) => {
			const now = Date.now()
			setX({
				members: family ? family.members.length : null,
				tokens: tokens ? tokens.items.length : null,
				archives: archive ? archive.items.length : null,
				activeCodes: codes ? codes.items.filter((c: { revoked: boolean; usesLeft: number; expiresAt: string }) => !c.revoked && c.usesLeft > 0 && Date.parse(c.expiresAt) > now).length : null,
				notifications,
			})
		})
	}, [pathname, data.admin])
	return settingsMeta(data, { ...x, theme })
}

const MetaContext = createContext<Record<Section, string> | null>(null)
const useMetaContext = () => useContext(MetaContext)!

const visibleGroups = (admin: boolean) => GROUPS.filter((g) => admin || g.items.every((i) => i.id !== 'beta'))

/** Меню слева (десктоп) */
function SettingsMenu() {
	const { data } = useTracker()
	const meta = useMetaContext()
	const pathname = usePathname()
	return (
		<nav aria-label="Разделы настроек" className="sticky top-4 hidden self-start border-r border-dashed border-line pr-6 sm:block">
			<h1 className="sec">Настройки</h1>
			{visibleGroups(!!data.admin).map((g) => (
				<div key={g.label} className="mt-5">
					<p className="text-[13px] text-muted uppercase">{g.label}</p>
					<ul className="mt-1">
						{g.items.map((i) => {
							const active = pathname === `/settings/${i.id}` || pathname.startsWith(`/settings/${i.id}/`)
							return (
								<li key={i.id}>
									<Link href={`/settings/${i.id}`} aria-current={active ? 'page' : undefined}
										className={`flex min-h-9 items-baseline justify-between gap-3 px-2 py-1.5 uppercase ${active ? 'bg-ink text-panel' : 'hover:bg-hover'}`}>
										<span className="shrink-0 whitespace-nowrap">{i.title}</span>
										<span title={meta[i.id]} className={`min-w-0 truncate text-xs ${active ? 'text-panel/70' : 'text-muted'}`}>{meta[i.id]}</span>
									</Link>
								</li>
							)
						})}
					</ul>
				</div>
			))}
		</nav>
	)
}

/** /settings: на мобильном — список разделов; на десктопе сразу переход в последний открытый */
export function SettingsIndex() {
	const { data } = useTracker()
	const meta = useMetaContext()
	const router = useRouter()
	useEffect(() => {
		if (!matchMedia('(min-width: 640px)').matches) return
		let last: string | null = null
		try {
			last = localStorage.getItem(LAST_SECTION_KEY)
		} catch {}
		const ok = last && visibleGroups(!!data.admin).some((g) => g.items.some((i) => i.id === last))
		router.replace(`/settings/${ok ? last : 'family'}`)
	}, [router, data.admin])
	return (
		// На десктопе список не виден (там меню слева), пока идёт переход
		<div className="sm:hidden">
			<h1 className="text-[22px] font-bold uppercase">Настройки</h1>
			{visibleGroups(!!data.admin).map((g) => (
				<div key={g.label} className="mt-6">
					<p className="text-[13px] text-muted uppercase">{g.label}</p>
					<ul className="mt-1">
						{g.items.map((i) => (
							<li key={i.id}>
								<Link href={`/settings/${i.id}`} className="flex min-h-[52px] items-center gap-3 border-b border-dashed border-line2 uppercase">
									<span className="flex-1">{i.title}</span>
									<span className="max-w-[50%] truncate text-xs text-muted">{meta[i.id]}</span>
									<span aria-hidden="true" className="text-muted">›</span>
								</Link>
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	)
}

/** Каркас: меню слева на десктопе, справа контент до 720px */
export function SettingsFrame({ children }: { children: ReactNode }) {
	const meta = useMeta()
	return (
		<MetaContext.Provider value={meta}>
			<div className="sm:grid sm:grid-cols-[260px_1fr] sm:gap-10">
				<SettingsMenu />
				<div className="min-w-0 max-w-[720px]">{children}</div>
			</div>
		</MetaContext.Provider>
	)
}

/** Страница раздела: заголовок 22px, на мобильном сверху ‹ НАСТРОЙКИ; раздел запоминается для /settings */
export function SectionPage({ section, children }: { section: Section; children: ReactNode }) {
	useEffect(() => {
		try {
			localStorage.setItem(LAST_SECTION_KEY, section)
		} catch {}
	}, [section])
	return (
		<>
			<Link href="/settings" className="tb mb-4 sm:hidden">‹ Настройки</Link>
			<h1 className="text-[22px] font-bold uppercase">{TITLES[section]}</h1>
			{children}
		</>
	)
}

/** Секция страницы: :: ЗАГОЛОВОК 13px, между секциями 28px */
export function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
	return (
		<section className="mt-7">
			<h2 className="sec mb-3 text-[13px]">
				{title}
				{note && <span className="font-normal normal-case"> // {note}</span>}
			</h2>
			{children}
		</section>
	)
}
