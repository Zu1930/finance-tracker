'use client'

import { useTracker } from '../TrackerProvider'
import { MONTHS, curMonthKey, fmt, monthKeyOf, termName } from '@/lib/utils'

const pad = (n: number) => String(n).padStart(2, '0')
const timeOf = (ts: number) => {
	const d = new Date(ts)
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Последние 20 трат текущего месяца */
export function ExpenseLogs() {
	const { data, addExpense, removeExpense, toast } = useTracker()
	const st = data.settings!
	const monthName = MONTHS[new Date().getMonth()].toLowerCase()
	const recent = [...(data.months[curMonthKey()]?.expenses ?? [])]
		.sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts)
		.slice(0, 20)
	const catName = (id: string) =>
		termName(
			st.categories.find((c) => c.id === id)?.name ?? 'Удалённая категория'
		)

	const remove = (mKey: string, id: string) => {
		const gone = removeExpense(mKey, id)
		if (gone) toast('Трата удалена', 'Вернуть', () => addExpense(gone))
	}

	return (
		<section className="mt-10 max-sm:pb-24">
			<h2 className="sec">Recent logs</h2>
			{recent.length === 0 ? (
				<p className="mt-3 text-muted uppercase">
					// За {monthName} записей пока нет
				</p>
			) : (
				<div className="mt-3 overflow-x-auto">
					<ul className="grid min-w-max grid-cols-[repeat(4,auto)_minmax(16ch,1fr)_auto_auto] gap-x-4">
						{recent.map((e) => (
							<li
								key={e.id}
								className="col-span-7 grid grid-cols-subgrid items-center border-b border-dashed border-line2 py-1 whitespace-nowrap"
							>
								<span className="text-muted">{e.date}</span>
								<span className="text-muted">{timeOf(e.ts)}</span>
								<span className="text-muted">[EXP]</span>
								<span className="text-right font-bold">
									-{fmt(e.amount)}
									{e.currency !== st.base && (
										<span className="ml-2 font-normal text-muted">
											(≈ {fmt(e.base)} {st.base})
										</span>
									)}
								</span>
								<span className="min-w-0 truncate">
									// {catName(e.catId)}
									{e.note && <span className="ml-2 text-muted">{e.note}</span>}
								</span>
								<span className="text-muted">[{e.currency}]</span>
								<button
									className="xb"
									aria-label="Удалить трату"
									onClick={() => remove(monthKeyOf(e.date), e.id)}
								>
									×
								</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	)
}
