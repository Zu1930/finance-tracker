'use client'

import { useTracker } from '../TrackerProvider'
import { AsciiBar } from '../AsciiBar'
import type { Category } from '@/lib/types'
import { curMonthKey, fmt, spentByCat, termName } from '@/lib/utils'

/** Остаток выбранной категории в текущем месяце, без выбора — по всем лимитам */
export function ExpenseSummary({
	cats,
	sel
}: {
	cats: Category[]
	sel: Category | undefined
}) {
	const { data } = useTracker()
	const st = data.settings!
	const spent = spentByCat(data.months[curMonthKey()]?.expenses ?? [])
	const limit = sel ? sel.limit : cats.reduce((acc, c) => acc + c.limit, 0)
	const used = sel
		? (spent[sel.id] ?? 0)
		: cats.reduce((acc, c) => acc + (spent[c.id] ?? 0), 0)
	const left = limit - used

	return (
		<section
			className="mt-6 border-t border-dashed border-line pt-6"
			aria-live="polite"
		>
			<h2 className="sec">{sel ? termName(sel.name) : 'Все лимиты'}</h2>
			<div className="mt-3">
				<AsciiBar
					value={used}
					max={limit}
					label={sel ? sel.name : 'Все лимиты'}
				/>
			</div>
			<p className={`mt-2 uppercase ${left < 0 ? 'text-bad' : 'text-muted'}`}>
				{left < 0
					? `Перерасход ${fmt(-left)} ${st.base}`
					: `Осталось ${fmt(left)} из ${fmt(limit)} ${st.base}`}
			</p>
		</section>
	)
}
