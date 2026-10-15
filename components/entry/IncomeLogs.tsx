'use client'

import { useState } from 'react'
import { useTracker } from '../TrackerProvider'
import { fmt, incomeSources, monthTitle, termName } from '@/lib/utils'

/** Сколько месяцев логов показывать до «Показать все» */
const MONTHS_SHOWN = 6

/** Все поступления по месяцам, новые сверху */
export function IncomeLogs() {
	const { data, addIncome, removeIncome, toast } = useTracker()
	const st = data.settings!
	const sources = incomeSources(st)
	const [showAll, setShowAll] = useState(false)

	const sourceName = (id: string) =>
		termName(sources.find((s) => s.id === id)?.name ?? 'Удалённый источник')

	const remove = (key: string, id: string) => {
		const gone = removeIncome(key, id)
		if (gone) toast('Удалено', 'Вернуть', () => addIncome(gone))
	}

	// Месяцы от новых к старым, внутри месяца — новые сверху
	const groups = Object.keys(data.incomes)
		.sort()
		.reverse()
		.map((key) => ({
			key,
			items: [...data.incomes[key].items].sort(
				(a, b) => b.date.localeCompare(a.date) || b.ts - a.ts
			)
		}))
		.filter((g) => g.items.length > 0)
	const shown = showAll ? groups : groups.slice(0, MONTHS_SHOWN)

	return (
		<section className="mt-10 max-sm:pb-24">
			<h2 className="sec">Income logs</h2>
			{groups.length === 0 ? (
				<p className="mt-3 text-muted uppercase">
					Поступлений пока нет. Введите сумму выше.
				</p>
			) : (
				<>
					<div className="mt-1 overflow-x-auto">
						<div className="grid min-w-[860px] grid-cols-[repeat(5,auto)_minmax(0,1fr)_auto] gap-x-4">
							{shown.map((g) => (
								<section
									key={g.key}
									className="col-span-full grid grid-cols-subgrid"
								>
									<h3 className="col-span-full mt-3 flex justify-between border-b border-dashed border-line2 py-2 text-muted uppercase">
										<span>-- {monthTitle(g.key)}</span>
										<span>
											+{fmt(g.items.reduce((a, i) => a + i.base, 0))}{' '}
											{st.base}
										</span>
									</h3>
									{g.items.map((i) => (
										<div
											key={i.id}
											className="col-span-full grid grid-cols-subgrid items-center border-b border-dashed border-line2 py-1 whitespace-nowrap"
										>
											<span className="text-muted">{i.date}</span>
											<span className="text-muted">[REV]</span>
											<b className="text-right">
												+{fmt(i.amount)} {i.currency}
											</b>
											<span className="text-muted">
												{i.currency !== st.base && `(≈ ${fmt(i.base)})`}
											</span>
											<span>// {sourceName(i.sourceId)}</span>
											<span className="min-w-0 truncate text-muted">
												{i.note || '—'}
											</span>
											<button
												className="xb"
												aria-label="Удалить поступление"
												onClick={() => remove(g.key, i.id)}
											>
												×
											</button>
										</div>
									))}
								</section>
							))}
						</div>
					</div>
					{groups.length > MONTHS_SHOWN && !showAll && (
						<button
							className="tb mt-4"
							onClick={() => setShowAll(true)}
						>
							Показать все
						</button>
					)}
				</>
			)}
		</section>
	)
}
