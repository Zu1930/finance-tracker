'use client'

import { useState } from 'react'
import { useTracker } from '../TrackerProvider'
import type { Expense, Income } from '@/lib/types'
import { fmt, incomeSources, termName } from '@/lib/utils'

/** Сколько строк показывать сразу и сколько добавлять по «Показать ещё» */
const PAGE = 30

type Row = { kind: 'expense'; e: Expense } | { kind: 'income'; e: Income }

/** Семейные траты обоих, мои личные и доходы обоих — новые сверху */
export function RecentLogs() {
	const { data, removeEntry, restoreEntry, toast } = useTracker()
	const st = data.settings!
	const [shown, setShown] = useState(PAGE)

	const cats = new Map([...st.familyCategories, ...data.mySettings.personalCategories].map((c) => [c.id, c.name]))
	const sources = new Map(incomeSources(st).map((s) => [s.id, s.name]))
	const names = new Map([data.me, data.partner].map((u) => [u.id, u.name]))

	const rows: Row[] = [
		...Object.values(data.familyExpenses).flat().map((e) => ({ kind: 'expense' as const, e })),
		...Object.values(data.myExpenses).flat().map((e) => ({ kind: 'expense' as const, e })),
		...Object.values(data.incomes).flat().map((e) => ({ kind: 'income' as const, e })),
	].sort((a, b) => b.e.date.localeCompare(a.e.date) || b.e.ts - a.e.ts)

	const remove = (r: Row) => {
		removeEntry(r.kind, r.e)
		toast('Удалено', 'Вернуть', () => restoreEntry(r.kind, r.e))
	}

	return (
		<section className="mt-10 max-sm:pb-24">
			<h2 className="sec">Recent logs</h2>
			{rows.length === 0 ? (
				<p className="mt-3 text-muted uppercase">// Записей пока нет</p>
			) : (
				<>
					<div className="mt-3 overflow-x-auto">
						<ul className="grid min-w-max grid-cols-[repeat(4,auto)_minmax(16ch,1fr)_auto_auto] gap-x-4">
							{rows.slice(0, shown).map((r) => {
								const income = r.kind === 'income'
								const e = r.e
								const what = income ? sources.get((e as Income).sourceId) : cats.get((e as Expense).catId)
								return (
									<li key={`${r.kind}-${e.id}`} className="col-span-7 grid grid-cols-subgrid items-center border-b border-dashed border-line2 py-1 whitespace-nowrap">
										<span className="text-muted">{e.date}</span>
										<span className="text-muted">{income ? '[REV]' : '[EXP]'}</span>
										<span className="text-muted">{income ? '' : (e as Expense).scope === 'personal' ? '[ЛИЧН]' : '[СЕМ]'}</span>
										<span className="text-right font-bold">
											{income ? '+' : '−'}
											{fmt(e.amount)} {e.currency}
											{e.currency !== st.base && <span className="ml-2 font-normal text-muted">(≈ {fmt(e.base)} {st.base})</span>}
										</span>
										<span className="min-w-0 truncate">
											// {termName(what ?? (income ? 'Удалённый источник' : 'Удалённая категория'))}
											{e.note && <span className="ml-2 text-muted">{e.note}</span>}
										</span>
										<span className="text-muted uppercase">{names.get(e.authorId) ?? '—'}</span>
										<button className="xb" aria-label={income ? 'Удалить доход' : 'Удалить трату'} onClick={() => remove(r)}>
											×
										</button>
									</li>
								)
							})}
						</ul>
					</div>
					{rows.length > shown && (
						<button className="tb mt-4" onClick={() => setShown((n) => n + PAGE)}>
							Показать ещё
						</button>
					)}
				</>
			)}
		</section>
	)
}
