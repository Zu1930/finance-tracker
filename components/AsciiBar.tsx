'use client'

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BAR_DEFAULT, BAR_MAX, barCells } from '@/lib/ascii'

const NARROW = '(max-width: 639px)'

/** Совпадает ли медиазапрос; на сервере — false */
export function useMedia(query: string) {
	return useSyncExternalStore(
		(cb) => {
			const mq = window.matchMedia(query)
			mq.addEventListener('change', cb)
			return () => mq.removeEventListener('change', cb)
		},
		() => window.matchMedia(query).matches,
		() => false
	)
}
/** true на экранах уже 640px */
export const useNarrow = () => useMedia(NARROW)
/** Ступени ширины десктопа (app/globals.css): wide 1600, huge 1920 */
export const WIDE = '(width >= 100rem)'
export const HUGE = '(width >= 120rem)'

/**
 * Сколько символов шкалы влезает в контейнер: ResizeObserver следит за шириной box, ширина «█» берётся
 * с уже нарисованной шкалы bar (символ может рисоваться запасным шрифтом). На сервере и до замера — 24
 */
export function useBarCells(max = BAR_MAX) {
	const box = useRef<HTMLDivElement>(null)
	const bar = useRef<HTMLSpanElement>(null)
	const [cells, setCells] = useState(BAR_DEFAULT)
	const charW = useRef(0)
	useLayoutEffect(() => {
		const el = box.current
		if (!el) return
		const fit = () => {
			const b = bar.current
			// Ширина символа — один раз, по шкале с известным числом символов
			if (!charW.current && b && b.textContent) charW.current = b.getBoundingClientRect().width / b.textContent.length
			setCells(barCells(el.clientWidth, charW.current, max))
		}
		fit()
		const ro = new ResizeObserver(fit)
		ro.observe(el)
		return () => ro.disconnect()
	}, [max])
	return { box, bar, cells }
}

type Props = {
	value: number
	max: number
	/** Не длиннее стольких символов (по умолчанию 60); сколько именно — решает ширина контейнера */
	maxCells?: number
	/** limit: STABLE / WARNING / OVERLOAD; goal: COLLECTING / COMPLETE */
	variant?: 'limit' | 'goal'
	/** Только шкала, без процента и статуса */
	bare?: boolean
	label: string
}

/** [████████░░░░░░] 62% - STABLE — шкала шириной в свой контейнер, не шире него */
export function AsciiBar({
	value,
	max,
	maxCells = BAR_MAX,
	variant = 'limit',
	bare = false,
	label
}: Props) {
	const { box, bar, cells: w } = useBarCells(maxCells)
	const pct = max > 0 ? (value / max) * 100 : value > 0 ? Infinity : 0
	const shown = Number.isFinite(pct) ? Math.round(pct) : 100
	const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w)

	let status: string,
		tone = ''
	if (variant === 'goal') status = pct >= 100 ? 'COMPLETE' : 'COLLECTING'
	else if (pct > 100) [status, tone] = ['OVERLOAD', 'text-bad']
	else if (pct >= 80) [status, tone] = ['WARNING', 'text-warn']
	else status = 'STABLE'

	return (
		<div
			ref={box}
			role="meter"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={Math.max(100, shown)}
			aria-valuenow={shown}
			aria-valuetext={bare ? `${shown}%` : `${shown}% ${status}`}
			className="flex max-w-full min-w-0 flex-wrap items-baseline gap-x-2 overflow-hidden whitespace-pre"
		>
			<span ref={bar} aria-hidden="true" data-bar>
				<span className="text-ink">{'█'.repeat(filled)}</span>
				<span className="text-dim">{'░'.repeat(w - filled)}</span>
			</span>
			{!bare && (
				<span
					aria-hidden="true"
					className={tone}
				>
					{shown}% - {status}
				</span>
			)}
		</div>
	)
}
