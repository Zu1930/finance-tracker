'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTracker } from './TrackerProvider'
import { useSpace } from './SpaceProvider'
import { dueRows } from './recurring/DueBlock'
import { useRecurring } from './recurring/useRecurring'
import { FOCUS_CMD } from './entry/QuickEntry'
import { Icon } from './icons/Icon'
import { t } from '@/lib/i18n'
import { filterCmds, step, type Cmd } from '@/lib/palette'
import { GROUPS } from '@/lib/settings-meta'
import { SPACE, SPACE_IDS, inSpace } from '@/lib/space'
import { MAX_AHEAD, monthsAhead } from '@/lib/plan'
import { curMonthKey, fmt, isMac, monthName, shiftMonth, termName, todayStr } from '@/lib/utils'

/** Окно по центру поверх страницы: Esc и клик мимо закрывают, фокус возвращается туда, где был */
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
	const back = useRef<Element | null>(null)
	useEffect(() => {
		back.current = document.activeElement
		const el = back
		return () => (el.current as HTMLElement | null)?.focus?.()
	}, [])
	return (
		<>
			<div aria-hidden="true" className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,.35)' }} onClick={onClose} />
			<div role="dialog" aria-modal="true" aria-label={label} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
				className="fixed top-[90px] left-1/2 z-50 flex max-h-[70dvh] w-[600px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col border border-ink bg-panel">
				{children}
			</div>
		</>
	)
}

/** Команды: разделы, бюджет, оплата ближайшего регулярного, запись траты, план следующего месяца, настройки */
function useCommands(): Cmd[] {
	const router = useRouter()
	const { data, setMonth } = useTracker()
	const { view, switchable, setSpace, readOnly } = useSpace()
	const { pay } = useRecurring(curMonthKey())
	const go = (href: string) => () => router.push(href)
	const next = shiftMonth(curMonthKey(), 1)
	const due = readOnly ? undefined : dueRows(data, todayStr()).find((r) => inSpace(r.payment.scope, view))
	return [
		{ id: 'write', group: t('palette.write'), label: t('palette.writeExpense'), keys: '/', run: () => {
			if (window.location.pathname === '/') window.dispatchEvent(new Event(FOCUS_CMD))
			else router.push('/?focus=cmd')
		} },
		{ id: 'go-entry', group: t('palette.go'), label: t('nav.entry'), run: go('/') },
		{ id: 'go-limits', group: t('palette.go'), label: t('nav.limits'), run: go('/limits') },
		{ id: 'go-money', group: t('palette.go'), label: t('nav.money'), run: go('/savings') },
		{ id: 'go-summary', group: t('palette.go'), label: t('nav.summary'), run: go('/summary') },
		...(switchable ? SPACE_IDS.map((s, i) => ({ id: `space-${s}`, group: t('palette.budget'), label: SPACE[s].name, keys: `Alt ${i + 1}`, run: () => setSpace(s) })) : []),
		...(due ? [{ id: 'pay', group: t('palette.pay'), label: `${termName(due.payment.name)} ${fmt(due.amount)}`, run: () => pay(due.payment, due.month) }] : []),
		...(monthsAhead(curMonthKey(), next) <= MAX_AHEAD ? [{ id: 'plan', group: t('palette.plan'), label: monthName(next), run: () => { setMonth(next); router.push('/limits') } }] : []),
		{ id: 'go-help', group: t('palette.go'), label: t('nav.help'), keys: '?', run: go('/help') },
		...GROUPS.flatMap((g) => g.items).filter((i) => i.id !== 'beta').map((i) => ({ id: `set-${i.id}`, group: t('palette.settings'), label: i.title, run: go(`/settings/${i.id}`) })),
	]
}

/** ⌘/Ctrl + K: поле, до 7 результатов, ↑ ↓ и Enter */
export function CommandPalette({ onClose }: { onClose: () => void }) {
	const cmds = useCommands()
	const [q, setQ] = useState('')
	const [i, setI] = useState(0)
	const list = filterCmds(cmds, q)
	const run = (c: Cmd | undefined) => {
		if (!c) return
		onClose()
		// После закрытия окна: фокус уже вернулся, команда может увести его дальше (в строку ввода)
		setTimeout(c.run)
	}
	return (
		<Modal label={t('palette.title')} onClose={onClose}>
			<div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
				<b aria-hidden="true">&gt;</b>
				<input autoFocus className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-dim" placeholder={t('palette.placeholder')}
					role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={list[i] ? `cmd-${list[i].id}` : undefined}
					aria-label={t('palette.title')} value={q}
					onChange={(e) => { setQ(e.target.value); setI(0) }}
					onKeyDown={(e) => {
						if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
							e.preventDefault()
							setI(step(i, e.key === 'ArrowDown' ? 1 : -1, list.length))
						} else if (e.key === 'Enter') {
							e.preventDefault()
							run(list[i])
						}
					}} />
				<kbd className="kbd">Esc</kbd>
			</div>
			<ul id="palette-list" role="listbox" className="overflow-y-auto">
				{list.length === 0 && <li className="px-3.5 py-3 text-muted">{t('palette.none')}</li>}
				{list.map((c, k) => (
					<li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={k === i}
						className={`grid min-h-11 cursor-pointer grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-dashed border-line2 px-3.5 ${k === i ? 'bg-ink text-panel' : 'hover:bg-hover'}`}
						onMouseEnter={() => setI(k)} onClick={() => run(c)}>
						<span className={`text-xs uppercase ${k === i ? '' : 'text-muted'}`}>{c.group}</span>
						<span className="truncate">{c.label}</span>
						{c.keys ? <kbd className="kbd">{c.keys}</kbd> : <span />}
					</li>
				))}
			</ul>
		</Modal>
	)
}

/** «?» — все горячие клавиши */
export function Shortcuts({ onClose }: { onClose: () => void }) {
	const mod = isMac() ? '⌘' : 'Ctrl'
	const rows: [string, string][] = [
		['/', t('keys.cmd')], [`${mod} K`, t('keys.palette')], ['Alt 1 · 2 · 3', t('keys.space')], ['Alt ← →', t('keys.mode')], ['Alt M', t('keys.mic')],
		['Enter', t('keys.enter')], ['Esc', t('keys.esc')], [`${mod} ,`, t('keys.settings')], ['?', t('keys.help')],
	]
	return (
		<Modal label={t('keys.title')} onClose={onClose}>
			<div className="flex items-center justify-between border-b border-line px-3.5 py-2">
				<b className="uppercase">:: {t('keys.title')}</b>
				<button className="ib -mr-2" autoFocus onClick={onClose}><Icon name="close" size={20} label={t('action.close')} /></button>
			</div>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-3.5 py-3">
				{rows.map(([k, v]) => <div key={k} className="contents"><dt><kbd className="kbd">{k}</kbd></dt><dd>{v}</dd></div>)}
			</dl>
		</Modal>
	)
}

/** ⌘/Ctrl + K — палитра (и из полей ввода), ? — горячие клавиши (не в полях) */
export function useHotkeyDialogs() {
	const [open, setOpen] = useState<'palette' | 'keys' | null>(null)
	const path = usePathname()
	useEffect(() => setOpen(null), [path])
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
				e.preventDefault()
				setOpen((o) => (o === 'palette' ? null : 'palette'))
			}
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [])
	return { open, setOpen }
}
