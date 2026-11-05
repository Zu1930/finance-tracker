'use client'

import { useSyncExternalStore } from 'react'

const NARROW = '(max-width: 639px)'
/** На узких экранах шкала короче, чтобы влезть в 360px без горизонтального скролла */
const NARROW_WIDTH = 20

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

type Props = {
	value: number
	max: number
	/** Ширина шкалы в символах на широких экранах */
	width?: number
	/** Ширина на экранах уже 640px */
	narrowWidth?: number
	/** limit: STABLE / WARNING / OVERLOAD; goal: COLLECTING / COMPLETE */
	variant?: 'limit' | 'goal'
	/** Только шкала, без процента и статуса */
	bare?: boolean
	label: string
}

/** [████████░░░░░░] 62% - STABLE */
export function AsciiBar({
	value,
	max,
	width = 32,
	narrowWidth = NARROW_WIDTH,
	variant = 'limit',
	bare = false,
	label
}: Props) {
	const narrow = useNarrow()
	// Ширина — в символах, не 100% колонки: на больших экранах шкала растёт только вместе со шрифтом (14 → 17px)
	const w = narrow ? Math.min(width, narrowWidth) : width
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
			role="meter"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={Math.max(100, shown)}
			aria-valuenow={shown}
			aria-valuetext={bare ? `${shown}%` : `${shown}% ${status}`}
			className="flex flex-wrap items-baseline gap-x-2 whitespace-pre"
		>
			<span aria-hidden="true">
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
