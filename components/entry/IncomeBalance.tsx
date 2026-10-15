'use client'

import { useTracker } from '../TrackerProvider'
import { AsciiBar } from '../AsciiBar'
import { Comparison } from './Comparison'
import { byAuthor } from '@/lib/metrics'
import { curMonthKey, fmt, monthTitle } from '@/lib/utils'

/** Доход месяца по людям и сравнительные показатели семьи */
export function IncomeBalance() {
	const { data } = useTracker()
	const st = data.settings!
	const month = curMonthKey()
	const sums = byAuthor(data.incomes[month] ?? [])
	const people = [data.me, data.partner].map((u) => ({ ...u, sum: sums[u.id] ?? 0 }))
	const top = Math.max(...people.map((p) => p.sum))
	const total = people.reduce((a, p) => a + p.sum, 0)

	return (
		<section className="mt-6 border-t border-dashed border-line pt-6" aria-live="polite">
			<h2 className="sec">Доход // {monthTitle(month)}</h2>
			<div className="mt-3 space-y-1 uppercase">
				{people.map((p) => (
					// На мобильном шкала уходит на отдельную строку под именем и суммой
					<div key={p.id} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 sm:grid-cols-[12ch_minmax(0,1fr)_auto]">
						<span className="text-muted">{p.name}</span>
						<div className="col-span-full max-sm:order-last sm:col-span-1">
							<AsciiBar value={p.sum} max={top} bare label={`Доход: ${p.name}`} />
						</div>
						<b className="text-right">
							+{fmt(p.sum)} {st.base}
						</b>
					</div>
				))}
			</div>
			<p className="mt-3 uppercase">
				<span className="text-muted">Всего</span> <b>+{fmt(total)} {st.base}</b>
			</p>
			<Comparison />
		</section>
	)
}
